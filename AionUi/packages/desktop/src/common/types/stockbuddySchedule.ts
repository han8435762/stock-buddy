/** Local update schedule (periodic material refresh). */
export interface UpdateSchedule {
  id: string;
  companyCode: string;
  frequencyMinutes: number;
  enabled: boolean;
  nextRunAt: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastStatus?: string;
}
