/**
 * 报告生成器 - 基于活动记录生成 Markdown 报告
 */

import { generateReport, type ActivityAnalysis } from './ai';

export interface Activity {
  id: number;
  timestamp: string;
  description: string;
  category: string;
  app_name: string;
  title: string;
}

/**
 * 根据活动记录生成报告
 */
export async function generateDailyReport(
  activities: Activity[],
  apiKey: string,
  template: string = 'standard'
): Promise<string> {
  if (activities.length === 0) {
    return '# 今日工作日报\n\n暂无活动记录。';
  }

  return generateReport(activities, 'daily', template, apiKey);
}

export async function generateWeeklyReport(
  activities: Activity[],
  apiKey: string,
  template: string = 'standard'
): Promise<string> {
  return generateReport(activities, 'weekly', template, apiKey);
}

export async function generateMonthlyReport(
  activities: Activity[],
  apiKey: string,
  template: string = 'standard'
): Promise<string> {
  return generateReport(activities, 'monthly', template, apiKey);
}

/**
 * 统计活动分类占比
 */
export function getCategoryStats(activities: Activity[]): Record<string, number> {
  const stats: Record<string, number> = {};
  activities.forEach(a => {
    stats[a.category] = (stats[a.category] || 0) + 1;
  });
  return stats;
}

/**
 * 格式化活动时间线
 */
export function formatTimeline(activities: Activity[]): string {
  return activities
    .map(a => {
      const time = new Date(a.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      const categoryEmoji: Record<string, string> = {
        dev: '💻',
        meeting: '📅',
        doc: '📝',
        communication: '💬',
        other: '📌',
      };
      return `${time} ${categoryEmoji[a.category] || '📌'} ${a.description}`;
    })
    .join('\n');
}
