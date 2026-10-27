// 作者：wwj
import {
  DEFAULT_VARIABLE_COUNT, MAX_VARIABLE_COUNT, getContentVariableNames, nextContentVariableName,
  readContentVariable, validateContentVariables, writeContentVariables,
} from './content-variables.js';

export function mountVariableSettings({ getSettings, persistSettings, cancel, onChange }) {
  const container = document.getElementById('nci-variables');
  const add = document.getElementById('nci-add-variable');
  const indexInput = document.getElementById('nci-idxvar');
  const status = document.getElementById('nci-variable-status');
  if (!container || !add || !indexInput || !status) return;

  async function commit(names, indexName) {
    const settings = getSettings();
    const next = { ...settings, variableNames: names, indexVariableName: indexName };
    try { validateContentVariables(next); }
    catch (error) { status.textContent = `${error.message}，已保留原设置`; render(); return; }
    cancel();
    const ctx = window.SillyTavern.getContext();
    const chatId = ctx.getCurrentChatId?.() ?? ctx.chatId;
    const vars = chatId != null && chatId !== '' ? ctx.chatMetadata?.variables : null;
    const text = readContentVariable(vars, settings);
    const index = vars?.[settings.indexVariableName];
    settings.variableNames = names;
    settings.variableName = names[0];
    settings.indexVariableName = indexName;
    persistSettings();
    if (vars) {
      if (text) writeContentVariables(vars, settings, text);
      if (typeof index === 'string') {
        Object.defineProperty(vars, indexName, { value: index, writable: true, enumerable: true, configurable: true });
      }
    }
    render();
    onChange();
    status.textContent = `已保存 ${names.length} 个正文变量${text ? '，已同步当前片段' : ''}`;
    if (vars) {
      try { await ctx.saveMetadata(); }
      catch { status.textContent = '变量设置已保存，但保存聊天失败；刷新后可能丢失当前片段'; }
    }
  }

  function render() {
    const settings = getSettings();
    const names = getContentVariableNames(settings);
    container.replaceChildren();
    names.forEach((name, i) => {
      const row = document.createElement('div');
      row.className = 'nci-row nci-variable-row';
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.id = i === 0 ? 'nci-var' : `nci-var-${i + 1}`;
      input.type = 'text';
      input.className = 'text_pole';
      input.dataset.nciVariable = String(i);
      input.value = name;
      input.spellcheck = false;
      label.htmlFor = input.id;
      label.textContent = `正文变量 ${i + 1}`;
      input.addEventListener('change', () => {
        const updated = getContentVariableNames(getSettings());
        updated[i] = input.value.trim();
        void commit(updated, indexInput.value.trim() || 'current_chapter_index');
      });
      row.append(label, input);
      if (i >= DEFAULT_VARIABLE_COUNT) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'menu_button nci-remove-variable';
        remove.textContent = '移除';
        remove.setAttribute('aria-label', `移除正文变量 ${i + 1}`);
        remove.addEventListener('click', () => {
          const updated = getContentVariableNames(getSettings());
          updated.splice(i, 1);
          void commit(updated, getSettings().indexVariableName);
        });
        row.append(remove);
      }
      const macro = document.createElement('code');
      macro.className = 'nci-variable-macro';
      macro.textContent = `{{getvar::${name}}}`;
      row.append(macro);
      container.append(row);
    });
    add.disabled = names.length >= MAX_VARIABLE_COUNT;
    add.textContent = `添加正文变量（${names.length}/${MAX_VARIABLE_COUNT}）`;
    indexInput.value = settings.indexVariableName;
  }

  add.addEventListener('click', () => {
    const settings = getSettings();
    const names = getContentVariableNames(settings);
    if (names.length >= MAX_VARIABLE_COUNT) return;
    names.push(nextContentVariableName(names, settings.indexVariableName));
    void commit(names, settings.indexVariableName);
  });
  indexInput.addEventListener('change', () => {
    void commit(getContentVariableNames(getSettings()), indexInput.value.trim() || 'current_chapter_index');
  });
  render();
}
