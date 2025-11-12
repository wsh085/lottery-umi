import analysisData from "data/analysis_data.json";
import allHistoryData from "data/all_history_data.json";

/**
 * 取最近 {count} 期的数据
 *
 * count 不传则返回全部数据
 * @param count
 * @returns
 */
export const getHistoryData = (count?: number): any[] => {
  if (count) {
    return allHistoryData.slice(-count);
  }
  return allHistoryData;
};

/**
 * 取全部历史数据
 * @returns
 */
export const getAllHistoryData = (): any[] => {
  return allHistoryData;
};

/**
 * 取某个维度 {key} 的数据
 *
 * key 不传则返回全部数据
 * @param count
 * @returns
 */
export const getAnalysisData = (key: string): any => {
  if (key) {
    return (analysisData as Record<string, any>)[key];
  }
  return analysisData;
};
