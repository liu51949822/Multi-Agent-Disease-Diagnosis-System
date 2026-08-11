import { BaseAgent } from './BaseAgent';
import { AgentState, AestheticResult } from './types';

export class AestheticAgent extends BaseAgent {
  constructor() {
    super('Aesthetic', '面部/形体美学分析');
  }

  async execute(state: AgentState): Promise<Partial<AgentState>> {
    this.log(`开始美学分析... (${state.image ? '含照片视觉分析' : '纯文字分析'})`);

    try {
      const result = state.image
        ? await this.analyzeWithImage(state.userMessage, state.image)
        : await this.analyzeText(state.userMessage);

      this.log(`美学分析完成 - 置信度: ${result.confidence}`);
      return { aestheticResults: result, errors: [] };
    } catch (error) {
      this.logError('美学分析失败', error);
      return {
        aestheticResults: {
          analyzed: false,
          photoObservations: [],
          facialAnalysis: '美学分析失败，请描述您的具体关注点',
          concerns: [],
          suggestions: ['建议咨询专业整形医生'],
          confidence: 0,
        },
        errors: [String(error)],
      };
    }
  }

  /** 有照片：图文混合调用 Gemini 视觉分析 */
  private async analyzeWithImage(message: string, imageDataUri: string): Promise<AestheticResult> {
    const prompt = `你是一名专业的整形美容美学分析师。请结合用户描述和上传的照片，进行面部/形体美学评估。
这是一个医疗咨询演示系统，你的分析仅作参考，不构成医疗建议。

用户描述: ${message}

请基于照片和描述，一次性返回以下 JSON，不要添加其他内容：
{
  "analyzed": true,
  "photoObservations": ["照片观察要点1（基于实际照片，客观描述）"],
  "facialAnalysis": "整体美学评估（100字以内，客观中立，避免冒犯性表述）",
  "concerns": ["可能的美学问题/关注点1"],
  "suggestions": ["可考虑的改善方向1（非手术或手术均可，但务必标注仅为参考）"],
  "confidence": 70
}

要求：
- 不要对照片中的人进行贬低或羞辱性评价，保持专业、客观、尊重
- 不承诺手术效果，不给出具体医疗建议
- 若照片无法识别，confidence 降低并在 facialAnalysis 中说明`;

    return await this.invokeVision<AestheticResult>(prompt, imageDataUri);
  }

  /** 无照片：纯文字美学分析（降级路径） */
  private async analyzeText(message: string): Promise<AestheticResult> {
    const prompt = `你是一名专业的整形美容美学分析师。请基于用户文字描述进行面部/形体美学评估。
这是一个医疗咨询演示系统，你的分析仅作参考，不构成医疗建议。

用户描述: ${message}

请返回以下 JSON，不要添加其他内容：
{
  "analyzed": false,
  "photoObservations": [],
  "facialAnalysis": "基于文字描述的美学评估（100字以内）",
  "concerns": ["可能的美学问题/关注点1"],
  "suggestions": ["可考虑的改善方向1"],
  "confidence": 50
}

要求：保持专业、客观、尊重；不承诺手术效果，不给出具体医疗建议；提醒用户上传照片可获得更精准的分析。`;

    return await this.invokeJSON<AestheticResult>(prompt);
  }
}
