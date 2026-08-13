function clamp01(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

export function createQualitySignalWindow(max = 50) {
  if (!Number.isInteger(max) || max < 1) throw new Error('quality window must be a positive integer.');
  const byKey = new Map();
  return {
    record(signal) {
      if (!signal || !signal.providerId || !signal.contentJob || !signal.taskType) throw new Error('providerId, contentJob, and taskType are required.');
      const key = `${signal.providerId}|${signal.contentJob}:${signal.taskType}`;
      const list = byKey.get(key) || [];
      list.push(structuredClone(signal));
      while (list.length > max) list.shift();
      byKey.set(key, list);
      return this.summary(signal.providerId, signal.contentJob, signal.taskType);
    },
    summary(providerId, contentJob, taskType) {
      const list = byKey.get(`${providerId}|${contentJob}:${taskType}`) || [];
      if (!list.length) return null;
      const average = (field, fallback = 0) => list.reduce((sum, item) => sum + clamp01(item[field], fallback), 0) / list.length;
      const evaluator = average('evaluatorScore', 0.5);
      const schema = average('schemaCompliance', 0.5);
      const acceptRate = average('accept', 0);
      const repairRate = average('repair', 0);
      const rejectRate = average('reject', 0);
      const score = clamp01(evaluator * 0.6 + schema * 0.2 + acceptRate * 0.15 + (1 - repairRate) * 0.05 - rejectRate * 0.05);
      return { score, observations: list.length, evaluatorScore: evaluator, schemaCompliance: schema, acceptRate, rejectRate, repairRate };
    },
  };
}
