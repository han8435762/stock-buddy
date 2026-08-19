export const tryChangeStockBuddyDirectory = async (
  change: () => Promise<string>,
  onError: (error: unknown) => void
): Promise<string | null> => {
  try {
    return await change();
  } catch (error) {
    onError(error);
    return null;
  }
};
