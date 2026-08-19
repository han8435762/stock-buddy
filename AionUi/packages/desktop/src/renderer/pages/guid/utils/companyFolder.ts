/**
 * StockBuddy company-folder helpers for the Guid (new conversation) page.
 *
 * Company library folders are created by the main process as `${code}_${name}`
 * (see companyService.ts), so the folder basename carries both the stock code
 * and the company name. This is what lets a conversation created in a company
 * folder be bound back to that company for sidebar grouping.
 */

const COMPANY_DIR_RE = /^(\d{6})_(.+)$/;

/**
 * Parse a company folder path into its stock code and company name, or null
 * when the path does not point at a company folder.
 */
export const parseCompanyDir = (dir: string): { companyId: string; companyName: string } | null => {
  const base =
    dir
      .split(/[\\/]+/)
      .filter(Boolean)
      .pop() ?? '';
  const match = COMPANY_DIR_RE.exec(base);
  return match ? { companyId: match[1], companyName: match[2] } : null;
};
