// E2E 测试：关键用户旅程（需要启动后端 + 前端后才能跑）
// 用法：cd frontend && npx playwright test ../e2e/
//
// 前提：backend 运行在 localhost:3000，frontend 运行在 localhost:5173，
//       且 GOOGLE_API_KEY 为真实 key（否则 API 调用失败）。

import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';

test.describe('整形多智能体系统 E2E', () => {
  test('① 文本咨询完整流程', async ({ page }) => {
    await page.goto(BASE);
    await expect(page.locator('text=整形美容智能顾问')).toBeVisible();

    // 输入问题
    await page.fill('textarea', '我想做双眼皮手术');
    await page.click('button:has-text("发送")');

    // 等待执行轨迹出现
    await page.waitForSelector('text=Agent 执行轨迹', { timeout: 30000 });
    await page.waitForSelector('text=综合建议', { timeout: 30000 });
  });

  test('② 暗色模式切换', async ({ page }) => {
    await page.goto(BASE);
    // 点击暗色按钮
    await page.click('button:has-text("🌙")');
    // 验证 html 有 dark class
    const cls = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(cls).toBe(true);
    // 切回浅色
    await page.click('button:has-text("☀️")');
  });

  test('③ 示例问题快速提问', async ({ page }) => {
    await page.goto(BASE);
    await page.click('button:has-text("我想做双眼皮")');
    await page.waitForSelector('text=Agent 执行轨迹', { timeout: 30000 });
  });

  test('④ 空消息校验', async ({ page }) => {
    await page.goto(BASE);
    // 直接用空输入点发送（按钮 disabled）
    const btn = page.locator('button:has-text("发送")');
    await expect(btn).toBeDisabled();
  });

  test('⑤ 未连接健康检查', async ({ page }) => {
    await page.goto(BASE);
    // 后端正常时应显示"已连接"
    await page.waitForSelector('text=已连接', { timeout: 10000 });
  });
});
