// 作者：wwj
export const DEFAULT_VARIABLE_COUNT = 3;
export const MAX_VARIABLE_COUNT = 5;

export function getContentVariableNames(settings) {
  return Array.isArray(settings.variableNames) ? [...settings.variableNames] : [settings.variableName];
}

export function nextContentVariableName(names, indexName) {
  let number = names.length + 1;
  let name;
  do { name = `current_chapter_${number++}`; } while (names.includes(name) || name === indexName);
  return name;
}

// 只迁移旧版单变量配置；第一项保留用户原名，补足默认三个目标。
export function migrateContentVariables(settings) {
  if (Array.isArray(settings.variableNames)) return false;
  const names = [settings.variableName?.trim() || 'current_chapter'];
  while (names.length < DEFAULT_VARIABLE_COUNT) {
    names.push(nextContentVariableName(names, settings.indexVariableName));
  }
  settings.variableNames = names;
  settings.variableName = names[0];
  return true;
}

export function validateContentVariables(settings) {
  const names = getContentVariableNames(settings);
  if (!names.length || names.length > MAX_VARIABLE_COUNT) throw new Error('正文变量最多可设置 5 个');
  if (names.some((name) => typeof name !== 'string' || !name.trim())) throw new Error('正文变量名不能为空');
  if (names.some((name) => name !== name.trim())) throw new Error('正文变量名首尾不能有空格');
  if (new Set(names).size !== names.length) throw new Error('正文变量名不能重复');
  if (names.includes(settings.indexVariableName)) throw new Error('正文变量名不能与进度变量名相同');
  return names;
}

export function readContentVariable(vars, settings) {
  for (const name of getContentVariableNames(settings)) {
    if (Object.hasOwn(vars || {}, name) && typeof vars[name] === 'string' && vars[name]) return vars[name];
  }
  return '';
}

export function writeContentVariables(vars, settings, text) {
  // 先完整校验再写入，避免只更新部分变量。
  const names = validateContentVariables(settings);
  for (const name of names) {
    Object.defineProperty(vars, name, { value: text, writable: true, enumerable: true, configurable: true });
  }
}

export function fillMissingContentVariables(vars, settings) {
  const text = readContentVariable(vars, settings);
  if (!text) return false;
  const missing = validateContentVariables(settings).filter((name) => !Object.hasOwn(vars, name) || !vars[name]);
  for (const name of missing) {
    Object.defineProperty(vars, name, { value: text, writable: true, enumerable: true, configurable: true });
  }
  return missing.length > 0;
}
