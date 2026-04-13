export type RuleNameInput = {
  rule: string;
  rulePayload: string;
  chains: string[];
};

export function buildRuleName(input: RuleNameInput): string {
  const rule = input.rule.trim();
  const rulePayload = input.rulePayload.trim();
  const lastChain = input.chains[input.chains.length - 1]?.trim() || '';

  // Surge collector already resolves the real rule/group name into `rule`
  // and mirrors it as the last chain hop. Preserve that behavior.
  if (rule && lastChain === rule) {
    return rule;
  }

  if (rule) {
    return rulePayload ? `${rule}(${rulePayload})` : rule;
  }

  return lastChain || 'DIRECT';
}
