import test from 'node:test';
import assert from 'node:assert/strict';
import {
  migrateContentVariables, writeContentVariables, fillMissingContentVariables, readContentVariable,
} from '../content-variables.js';

test('新装默认三变量，旧自定义第一变量保留，迁移只执行一次', () => {
  const fresh = { variableName: 'current_chapter', indexVariableName: 'current_chapter_index' };
  assert.equal(migrateContentVariables(fresh), true);
  assert.deepEqual(fresh.variableNames, ['current_chapter', 'current_chapter_2', 'current_chapter_3']);
  const old = { variableName: 'my_novel', indexVariableName: 'index' };
  migrateContentVariables(old);
  assert.deepEqual(old.variableNames, ['my_novel', 'current_chapter_2', 'current_chapter_3']);
  old.variableNames.push('four', 'five');
  assert.equal(migrateContentVariables(old), false);
  assert.equal(old.variableNames.length, 5);
});

test('自动补充的默认名称避开已有正文与进度变量', () => {
  const settings = { variableName: 'current_chapter_2', indexVariableName: 'current_chapter_3' };
  migrateContentVariables(settings);
  assert.deepEqual(settings.variableNames, ['current_chapter_2', 'current_chapter_4', 'current_chapter_5']);
});

test('三个或五个目标得到完全相同的正文，其他变量保留', () => {
  for (const count of [3, 5]) {
    const settings = { variableNames: Array.from({ length: count }, (_, i) => `text_${i}`), indexVariableName: 'index' };
    const vars = { unrelated: '保留', index: '2' };
    writeContentVariables(vars, settings, '正文\n含空格 😀');
    for (const name of settings.variableNames) assert.equal(vars[name], '正文\n含空格 😀');
    assert.equal(vars.unrelated, '保留');
    assert.equal(vars.index, '2');
  }
});

test('空名、重名、进度冲突及超过五个，写入前拒绝且保留所有旧值', () => {
  for (const names of [['a', '', 'b'], ['a', 'b', 'a'], ['a', 'b', 'index'], ['a', 'b', 'c', 'd', 'e', 'f']]) {
    const vars = { a: '旧A', b: '旧B', index: '1' };
    assert.throws(() => writeContentVariables(vars, { variableNames: names, indexVariableName: 'index' }, '新正文'));
    assert.deepEqual(vars, { a: '旧A', b: '旧B', index: '1' });
  }
});

test('升级时用已有片段补空目标，不请求新内容、不覆盖非空目标', () => {
  const settings = { variableNames: ['first', 'second', 'third'], indexVariableName: 'index' };
  const vars = { second: '旧正文', third: '第三项原值', index: '7' };
  assert.equal(fillMissingContentVariables(vars, settings), true);
  assert.equal(vars.first, '旧正文');
  assert.equal(vars.third, '第三项原值');
  assert.equal(vars.index, '7');
  assert.equal(fillMissingContentVariables(vars, settings), false);
  assert.equal(readContentVariable({}, settings), '');
});

test('对象原型同名变量也按普通正文名称存储和序列化', () => {
  const settings = { variableNames: ['__proto__', 'constructor', 'toString'], indexVariableName: 'index' };
  const vars = {};
  assert.equal(readContentVariable(vars, settings), '');
  writeContentVariables(vars, settings, '正文');
  assert.equal(Object.getPrototypeOf(vars), Object.prototype);
  assert.deepEqual(Object.values(JSON.parse(JSON.stringify(vars))), ['正文', '正文', '正文']);
});
