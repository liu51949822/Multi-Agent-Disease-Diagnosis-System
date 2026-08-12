/**
 * 真实领域工具（非 LLM，纯计算/规则）——证明 Agent 不只"读文档"还会"做事"。
 *
 * 面试叙事：当前 Agent 不仅能 RAG 检索，还有真实的 domain logic tool。
 * 这些工具不依赖 LLM，是确定性的计算/规则，体现 agentic tool 的"可信性"。
 */

export interface ContraindicationResult {
  ok: boolean;
  warnings: string[];
  matched: string[];
}

const CONTRAINDICATIONS: Record<string, string[]> = {
  '怀孕': ['妊娠期禁止任何选择性手术', '建议产后再评估'],
  '哺乳': ['哺乳期需暂停母乳后才可手术', '请告知麻醉医生'],
  '阿司匹林': ['需停用阿司匹林至少 5-7 天后方可手术', '请告知医生具体用药情况'],
  '华法林': ['抗凝药物需在医生指导下停药调整', '需提前 5-7 天停药并做凝血检查'],
  '高血压': ['血压需控制在正常范围内方可手术', '建议术前 2 周监测血压'],
  '糖尿病': ['血糖需稳定控制，HbA1c < 7% 为宜', '术前可能需调整降糖方案'],
  '心脏病': ['需心脏专科评估手术风险', '出具心脏功能评估报告'],
  '瘢痕': ['瘢痕体质者需充分沟通术后疤痕风险', '建议试做较小范围测试'],
  '甲状腺': ['甲状腺功能异常需内分泌科评估', '甲功正常后方可手术'],
  '过敏性': ['需告知医生完整过敏史', '青霉素、麻药等过敏需特别标注'],
};

/**
 * 禁忌症核对工具：根据用户描述检测常见风险因素。
 * 这是真实 domain logic（规则匹配），不是 LLM 生成。
 */
export function checkContraindications(userMessage: string): ContraindicationResult {
  const lower = userMessage.toLowerCase();
  const warnings: string[] = [];
  const matched: string[] = [];

  for (const [keyword, msgs] of Object.entries(CONTRAINDICATIONS)) {
    if (lower.includes(keyword)) {
      matched.push(keyword);
      warnings.push(...msgs);
    }
  }

  // 通用提醒
  if (warnings.length === 0) {
    warnings.push('未检测到明确的禁忌症关键词，仍建议术前做全面体检');
  }

  return { ok: matched.length === 0, warnings, matched };
}

interface RecoveryInfo {
  procedure: string;
  timeline: string;
  restrictions: string[];
  followUp: string;
}

const RECOVERY_DATA: Record<string, RecoveryInfo> = {
  '重睑术': {
    procedure: '重睑术',
    timeline: '术后 1-3 天肿胀期 → 5-7 天拆线 → 1-2 周消肿 → 1-3 个月恢复自然',
    restrictions: ['术后 1 周内避免用力揉眼', '拆线前伤口勿沾水', '1 个月内避免剧烈运动'],
    followUp: '拆线后 1 周、1 个月各复诊一次',
  },
  '双眼皮': {
    procedure: '重睑术（双眼皮）',
    timeline: '术后 1-3 天肿胀期 → 5-7 天拆线 → 1-2 周消肿 → 1-3 个月恢复自然',
    restrictions: ['术后 1 周内避免用力揉眼', '拆线前伤口勿沾水'],
    followUp: '拆线后 1 周、1 个月各复诊一次',
  },
  '隆鼻': {
    procedure: '隆鼻术',
    timeline: '术后 1-2 周肿胀期 → 3-6 个月完全稳定',
    restrictions: ['避免碰撞鼻部', '完全恢复前避免佩戴眼镜压迫鼻梁', '2 个月内避免擤鼻涕'],
    followUp: '术后 1 周、1 个月、3 个月各复诊一次',
  },
  '抽脂': {
    procedure: '抽脂术',
    timeline: '术后 1-3 天肿胀积液 → 严格穿塑身衣 1-3 个月 → 3-6 个月轮廓完全显现',
    restrictions: ['必须穿塑身衣（遵医嘱确定时长）', '1 个月内避免剧烈运动', '避免长时间站立不动'],
    followUp: '术后 1 周、1 个月、3 个月复诊',
  },
  '玻尿酸': {
    procedure: '玻尿酸填充',
    timeline: '注射后 1-3 天轻微红肿 → 1-2 周效果稳定 → 6-18 个月逐步吸收',
    restrictions: ['注射后 24 小时内避免化妆', '2 周内避免高温环境（桑拿/温泉）', '避免按摩注射部位'],
    followUp: '效果稳定后复查，约 6-12 月补充注射',
  },
  '肉毒素': {
    procedure: '肉毒素注射',
    timeline: '注射后 3-7 天开始见效 → 维持 4-6 个月',
    restrictions: ['注射后 4-6 小时勿平躺', '24 小时内勿剧烈运动', '2 周内避免面部按摩/热敷'],
    followUp: '效果稳定后复查，约 4-6 月补充注射',
  },
};

/** 恢复期测算工具：按项目名查找标准恢复信息 */
export function getRecoveryInfo(procedureName: string): RecoveryInfo | null {
  const key = Object.keys(RECOVERY_DATA).find(
    (k) => procedureName.includes(k) || k.includes(procedureName),
  );
  return key ? RECOVERY_DATA[key] : null;
}
