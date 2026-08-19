const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

exports.default = async function afterSign(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  // Lazy-load notarize because @electron/notarize is ESM-only
  const { notarize } = await import('@electron/notarize');

  const appName = context.packager.appInfo.productFilename;
  const appBundleId = context.packager.appInfo.id;
  const appPath = `${appOutDir}/${appName}.app`;

  // Finder/file-provider metadata can be copied into the app bundle when the
  // project lives in a synced folder. macOS codesign rejects those attributes
  // with "resource fork, Finder information, or similar detritus not allowed".
  // Clear them before verification so unsigned local builds can still receive
  // the ad-hoc signature used by the local packaging flow.
  const clearMacOSMetadata = () => {
    try {
      execFileSync('xattr', ['-cr', appPath], { stdio: 'ignore' });
      return true;
    } catch (error) {
      console.warn(`Failed to clear macOS extended attributes from ${appName}: ${error.message}`);
      return false;
    }
  };

  const signAdHocInCleanStaging = () => {
    const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stockbuddy-sign-'));
    const stagedAppPath = path.join(stagingRoot, `${appName}.app`);

    try {
      // A synced project directory may reattach Finder/FileProvider metadata
      // while codesign recursively walks the bundle. ditto's no-resource-fork
      // mode gives codesign a metadata-free copy on a local temporary path.
      execFileSync('ditto', ['--norsrc', '--noqtn', appPath, stagedAppPath], { stdio: 'ignore' });
      execFileSync('xattr', ['-cr', stagedAppPath], { stdio: 'ignore' });
      execFileSync('codesign', ['--force', '--deep', '--sign', '-', stagedAppPath], { stdio: 'inherit' });

      // Replace only the generated app bundle. The signed copy is then used by
      // electron-builder to create the DMG/ZIP artifacts.
      fs.rmSync(appPath, { recursive: true, force: true });
      try {
        fs.renameSync(stagedAppPath, appPath);
      } catch (error) {
        if (error.code !== 'EXDEV') throw error;
        execFileSync('ditto', ['--norsrc', '--noqtn', stagedAppPath, appPath], { stdio: 'ignore' });
      }
    } finally {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
  };

  clearMacOSMetadata();

  // Check if app is actually signed before attempting notarization
  try {
    execSync(`codesign --verify --verbose "${appPath}"`, { stdio: 'pipe' });
    console.log(`App ${appName} is properly code signed`);
  } catch (error) {
    console.log(`App ${appName} is not code signed, applying ad-hoc signature...`);
    try {
      // File-provider folders can reattach metadata while the bundle is being
      // traversed. Clear it again immediately before signing and retry once if
      // the filesystem races the first signing attempt.
      clearMacOSMetadata();
      execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
      console.log(`Ad-hoc signature applied successfully to ${appName}`);
    } catch (adHocError) {
      try {
        clearMacOSMetadata();
        execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
        console.log(`Ad-hoc signature applied successfully to ${appName} after retry`);
      } catch (retryError) {
        try {
          console.log('Retrying ad-hoc signing from a clean local staging directory...');
          signAdHocInCleanStaging();
          console.log(`Ad-hoc signature applied successfully to ${appName} from clean staging`);
        } catch (stagingError) {
          console.error('Ad-hoc signing failed:', stagingError.message || retryError.message || adHocError.message);
        }
      }
    }
    return;
  }

  // Skip notarization if credentials are not provided
  if (!process.env.appleId || !process.env.appleIdPassword) {
    console.log('Skipping notarization - missing Apple ID credentials');
    return;
  }

  console.log(`Starting notarization for ${appName} (${appBundleId})...`);

  try {
    await notarize({
      tool: 'notarytool',
      appBundleId,
      appPath: appPath,
      appleId: process.env.appleId,
      appleIdPassword: process.env.appleIdPassword,
      teamId: process.env.teamId,
    });
    console.log('Notarization completed successfully');
  } catch (error) {
    console.error('Notarization failed:', error);
    throw error;
  }
};
