/** 通过 chrome.scripting 序列化到目标 frame；所有依赖必须留在函数内部。 */
export async function pageAction(action, payload = {}) {
  // 这个函数会被 chrome.scripting 序列化后注入页面，全部依赖必须留在函数内部。
  // 注入函数抛出的异常不会把消息带回扩展，因此整段包在 try 中，统一转成 { ok:false, error } 返回。
  try {
    if (action === 'focusState') return { ok: true, visible: document.visibilityState === 'visible', focused: document.hasFocus() };
    function releaseSampleRun(tracker) {
      tracker?.observer?.disconnect();
      if (tracker?.timer) clearTimeout(tracker.timer);
      if (globalThis.__nexlySampleRun === tracker) delete globalThis.__nexlySampleRun;
    }
    if (action === 'releaseRun') {
      const tracker = globalThis.__nexlySampleRun;
      if (tracker?.token === payload.runToken) releaseSampleRun(tracker);
      return { ok: true };
    }
    const normalize = (value) => String(value || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
    const visible = (el) => {
      if (!el || el.closest('[hidden],[inert],[aria-hidden="true"],[data-nexly-controls]')) return false;
      for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
      }
      const pane = el.closest('[role="tabpanel"]');
      const tab = pane?.getAttribute('aria-labelledby');
      if (tab && document.getElementById(tab)?.getAttribute('aria-selected') === 'false') return false;
      return [...el.getClientRects()].some((rect) => rect.width > 0 && rect.height > 0);
    };
    const frameContext = () => {
      let shown = true;
      try { for (let view = window; view !== view.parent && view.frameElement; view = view.parent) { if (!visible(view.frameElement)) { shown = false; break; } } } catch {}
      return { url: location.href, shown, children: [...document.querySelectorAll('iframe,frame')].map((el) => ({ url: el.src || 'about:blank', shown: visible(el) })) };
    };
    const readResult = (result) => action === 'read' ? { ...result, frame: frameContext() } : result;
    const all = (selector, root = document) => [...root.querySelectorAll(selector)].filter(visible);
    const text = (el) => normalize(el?.innerText || el?.textContent);
    const hash = (value) => {
      let result = 2166136261;
      for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
      return (result >>> 0).toString(16);
    };
    const marker = /(?:编程|单选|多选|判断|填空|简答)题|第\s*\d+\s*\/\s*\d+\s*题/;
    const courseHost = new URL(location.href).hostname;
    const selectedCourseRoots = (courseHost === 'moodle.syxy.ouchn.cn' || ['chaoxing.com', 'zhihuishu.com', 'icourse163.org'].some((host) => courseHost === host || courseHost.endsWith(`.${host}`))) ? all('[data-quizmate-course-question="selected"]') : [];
    if (selectedCourseRoots.length > 1) return readResult({ ok: false, error: '网课区有多个选中题块，请重新选择本题' });
    const courseQuestion = selectedCourseRoots.length === 1;
    const candidates = all('[data-nexly-question],.question-container,.exam-question,.question-box,.problem-container,.subject-container').filter((el) => marker.test(text(el)) || el.hasAttribute('data-nexly-question'));
    const leafCandidates = candidates.filter((candidate) => !candidates.some((other) => candidate !== other && candidate.contains(other)));
    if (!courseQuestion && leafCandidates.length > 1) return readResult({ ok: false, error: '页面同时显示多个活动题目区域，请选中需要处理的题目' });
    const root = selectedCourseRoots[0] || leafCandidates[0] || document.body;
    if (!root) return readResult({ ok: false, error: '页面尚未加载完成' });

    const editorSelector = '.monaco-editor:not(.original-in-monaco-diff-editor),.ace_editor,.CodeMirror,textarea[data-code-editor],textarea.code-editor,textarea[data-language]';
    const scopedEditors = all(editorSelector, root);
    const editorRoots = scopedEditors.length ? scopedEditors : all(editorSelector);

    function questionText() {
      const clone = root.cloneNode(true);
      const originals = [...root.querySelectorAll('*')], copies = [...clone.querySelectorAll('*')];
      originals.forEach((el, index) => { if (!visible(el)) copies[index]?.remove(); });
      clone.querySelectorAll('script,style,nav,header,footer,button,textarea,input,select,.monaco-editor,.ace_editor,.CodeMirror,[contenteditable="true"],[hidden],[aria-hidden="true"],.ant-tabs-content-holder,.test-results,.execution-result,[data-nexly-result]').forEach((el) => el.remove());
      // 克隆节点没有布局；为块级元素加换行后读 textContent，避免题干、样例挤成一行。
      clone.querySelectorAll('p,div,section,article,h1,h2,h3,h4,h5,h6,li,pre,tr,br').forEach((el) => el.append(document.createTextNode('\n')));
      let value = normalize(clone.textContent).replace(/\n[ \t]*\n+/g, '\n');
      const start = value.search(marker);
      if (start >= 0) value = value.slice(start);
      value = value.replace(/\n(?:控制台|测试用例|提交结果|提交记录|执行结果|重置代码|HarmonyOS Developer|工具\s*\n)[\s\S]*$/, '').trim();
      return value;
    }
    const stem = questionText();
    if (!marker.test(stem) && !root.hasAttribute('data-nexly-question') && !courseQuestion) return readResult({ ok: false, error: '此 frame 没有识别到练习题，不会操作普通表单' });
    if (!stem || stem.length > 48000) return readResult({ ok: false, error: '题干过长或未能定位题目区域，请缩小页面内容或反馈页面结构' });

    // 原生 radio/checkbox 常被站点用 display:none / visibility:hidden 隐藏、只显示自绘样式。
    // 只要它自己、它的 label 包装或所在选项行可见，就仍然算作可操作的真实选项。
    const optionWrapper = 'label,.ant-radio-wrapper,.ant-checkbox-wrapper,.el-radio,.el-checkbox';
    const usableOption = (node) => visible(node) || visible(node.closest(optionWrapper)) || visible(node.parentElement);
    const isOptionNode = (node) => !node.closest('[role="radio"],[role="checkbox"]') || node.matches('[role="radio"],[role="checkbox"]');
    let optionSelector = 'input[type="radio"],input[type="checkbox"],[role="radio"],[role="checkbox"]';
    if (courseQuestion && !root.querySelector(optionSelector)) optionSelector = '.Zy_ulTop > li,.answerBg .answer_p,.choices > li,.optionUl label,.nodeLab,.option-result';
    const rawOptionNodes = [...root.querySelectorAll(optionSelector)].filter(isOptionNode);
    const optionNodes = rawOptionNodes.filter(usableOption);
    const optionLabel = (el) => {
      const label = el.closest(optionWrapper);
      return text(label) || (el.id ? text(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) : '') || el.getAttribute('aria-label') || (courseQuestion && !el.matches('input') ? text(el) : text(el.parentElement));
    };
    const options = optionNodes.map((el, i) => { const value = optionLabel(el); return { id: `option-${i}`, label: value.match(/^([A-Z])[.、．\s]/)?.[1] || String.fromCharCode(65 + i), text: value }; });
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const classSelected = (el) => /(?:^|[\s_-])(?:is-)?(?:checked|selected|chosen)(?:$|[\s_-])/i.test(el?.className || '');
    const optionWrapperOf = (node) => node.closest('[role="radio"],[role="checkbox"],label,.ant-radio-wrapper,.ant-checkbox-wrapper,.el-radio,.el-checkbox') || node;
    // 自绘选项状态不一定写回 checked/aria-checked：原生选中态、ARIA 状态、选项行与指示元素的选中类名依次读取。
    const optionSelected = (node) => {
      if (node.matches && node.matches('input') && node.checked === true) return true;
      const ariaHosts = [node, node.closest('[aria-checked],[aria-selected],[aria-pressed]')].filter(Boolean);
      for (const el of ariaHosts) {
        const aria = ['aria-checked', 'aria-selected', 'aria-pressed'].map((name) => el.getAttribute(name)).find((value) => value != null);
        if (aria != null) return aria === 'true';
      }
      const row = optionWrapperOf(node);
      if ([node, row, row.parentElement].some(classSelected)) return true;
      return [...row.querySelectorAll('i,span,em,svg,b')].some(classSelected);
    };
    const liveRoot = () => (root.isConnected ? root : document);
    // 站点可能在点击后重建选项节点，回读必须重新查询当前 DOM，不能只用旧引用。
    const liveOptionNodes = () => [...liveRoot().querySelectorAll(optionSelector)].filter(isOptionNode).filter(usableOption);
    const freshOption = (index) => { const live = liveOptionNodes(); return (live.length === optionNodes.length ? live[index] : null) || optionNodes[index]; };
    const selectedIds = () => {
      const live = liveOptionNodes();
      if (live.length !== optionNodes.length) return null;
      return live.map((node, i) => (optionSelected(node) ? `option-${i}` : null)).filter(Boolean);
    };
    const liveDone = (desired) => { const ids = selectedIds(); return ids != null && ids.length === desired.size && ids.every((id) => desired.has(id)); };
    const dispatchTo = (el, type, init, Ctor) => { try { if (typeof Ctor === 'function' && el.isConnected) el.dispatchEvent(new Ctor(type, init)); } catch {} };
    // 部分站点只用指针事件（或事件绑在选项行上）切换选中态：先点击，回读不一致再补发完整指针序列和选项行点击。
    const pressOption = (el) => {
      const base = { bubbles: true, cancelable: true, composed: true, button: 0 };
      const view = typeof window === 'undefined' ? null : window;
      dispatchTo(el, 'pointerdown', { ...base, view, pointerId: 1, isPrimary: true, buttons: 1 }, typeof PointerEvent === 'function' ? PointerEvent : null);
      dispatchTo(el, 'mousedown', { ...base, view, buttons: 1 }, typeof MouseEvent === 'function' ? MouseEvent : null);
      dispatchTo(el, 'pointerup', { ...base, view, pointerId: 1, isPrimary: true, buttons: 0 }, typeof PointerEvent === 'function' ? PointerEvent : null);
      dispatchTo(el, 'mouseup', { ...base, view, buttons: 0 }, typeof MouseEvent === 'function' ? MouseEvent : null);
      try { if (el.isConnected) el.click(); } catch {}
    };
    // 返回 { ok, verified }：ok 表示点击已生效；verified 表示能从页面读到选中状态。
    const applyOption = async (index, wanted) => {
      let node = freshOption(index);
      if (!node) return { ok: false, verified: false };
      if (optionSelected(node) === wanted) return { ok: true, verified: true };
      pressOption(node); await pause(40);
      node = freshOption(index);
      if (node && optionSelected(node) === wanted) return { ok: true, verified: true };
      const wrapper = node ? optionWrapperOf(node) : null;
      if (wrapper && wrapper !== node) {
        pressOption(wrapper); await pause(40);
        node = freshOption(index);
        if (node && optionSelected(node) === wanted) return { ok: true, verified: true };
      }
      // 自绘控件可能完全不暴露选中状态：单选框/判断题点击即生效，读不到任何选中态时按点击结果继续并提示人工核对。
      const blind = liveOptionNodes().every((entry) => optionSelected(entry) === false);
      return { ok: blind && type !== 'multiple' && !courseQuestion, verified: false };
    };
    const inputNodes = all('textarea,input:not([type]),input[type="text"],input[type="number"],[contenteditable="true"]', root).filter((el) => !el.closest('.monaco-editor,.ace_editor,.CodeMirror') && !el.matches('[role="combobox"]') && !el.closest('.ant-select,.el-select,.test-cases,[data-nexly-tests]'));
    // 题型以页面显式标识和实际选项结构为准。页面上任何可见的代码编辑器（例如常驻 IDE 面板、
    // 上一题遗留的编辑器）都不能把单选题判成编程题，否则会写入代码并试图点击“执行验证”。
    const hasCheckbox = rawOptionNodes.some((el) => el.type === 'checkbox' || el.getAttribute('role') === 'checkbox');
    // 题目区域内没有编辑器时，只有题面也看不出选项（A./B.、A、B、）才接受页面其它位置的编辑器。
    const optionMarks = (stem.match(/(?:^|[\s\n:：])[A-D][.、．)）](?=\s*\S)/g) || []).length;
    const hasChoiceOptions = optionNodes.length >= 2;
    let type;
    if (/编程题/.test(stem)) type = 'code';
    else if (/多选题/.test(stem)) type = 'multiple';
    else if (/判断题/.test(stem)) type = 'judge';
    else if (/单选题/.test(stem)) type = 'single';
    else if (/填空题/.test(stem)) type = 'blank';
    else if (/简答题/.test(stem)) type = 'text';
    else if (hasCheckbox) type = 'multiple';
    else if (hasChoiceOptions) type = 'single';
    else if (scopedEditors.length) type = 'code';
    else if (optionMarks >= 2) type = 'single';
    else if (editorRoots.length) type = 'code';
    else type = 'text';
    const fields = type === 'blank' || type === 'text' ? inputNodes.map((el, i) => ({ id: `field-${i}`, label: el.getAttribute('aria-label') || el.getAttribute('placeholder') || `第 ${i + 1} 空` })) : [];
    if (['single', 'multiple', 'judge'].includes(type) && (options.length < 2 || options.some((o) => !o.text))) return readResult({ ok: false, error: '选择题选项不完整，已停止识别' });
    if (['blank', 'text'].includes(type) && !fields.length) return readResult({ ok: false, error: '没有识别到可编辑答案区域' });
    // 只有编程题才查找执行入口；选择题、填空题等的页面上出现的“验证/执行”按钮一律不属于本流程。
    // 按显式程度分级：先认“执行代码/运行代码”，再认“执行验证/代码验证”，最后才接受单独的“执行/运行”。
    // 同级存在多个候选时停止而不猜测，也不把“提交”“交卷”当成执行按钮。
    const runLabels = [
      /^(?:执行代码|运行代码|运行测试|RunCode|RunTests|Run)$/i,
      /^(?:执行验证|验证代码|代码验证|运行验证|执行自测|自测)$/i,
      /^(?:执行|运行)$/i
    ];
    const buttonText = (el) => normalize(el.getAttribute('aria-label') || el.getAttribute('title') || text(el)).replace(/\s+/g, '');
    const isDisabled = (el) => el.disabled || el.getAttribute('aria-disabled') === 'true' || /loading|disabled/i.test(el.className || '');
    function runEntry() {
      const none = { available: false, reason: 'not-code', label: '', count: 0, disabled: false, element: null };
      if (type !== 'code') return none;
      // 双保险：页面上只要存在成对的真实选项控件，就不提供执行入口，避免把选择题当成编程题去验证。
      if (hasChoiceOptions) return { ...none, reason: 'choice-options', count: optionNodes.length };
      const candidates = all('button,[role="button"],a', root)
        .map((el) => ({ el, text: buttonText(el) }))
        .map((entry) => ({ ...entry, rank: runLabels.findIndex((pattern) => pattern.test(entry.text)) }))
        .filter((entry) => entry.rank >= 0);
      if (!candidates.length) return { ...none, reason: 'missing' };
      const best = Math.min(...candidates.map((entry) => entry.rank));
      const winners = candidates.filter((entry) => entry.rank === best);
      if (winners.length !== 1) return { ...none, reason: 'ambiguous', count: winners.length };
      return { available: true, reason: '', label: winners[0].text, count: 1, disabled: isDisabled(winners[0].el), element: winners[0].el };
    }
    // 注入结果会被结构化克隆，DOM 节点不能离开页面。
    const runInfo = (entry = runEntry()) => ({ available: entry.available, reason: entry.reason, label: entry.label, count: entry.count, disabled: entry.disabled });
    const language = all('select,[role="combobox"],.ant-select-selection-item,.el-select__selected-item', root).map((el) => el.tagName === 'SELECT' ? el.selectedOptions?.[0]?.textContent : text(el) || text(el.parentElement)).find((value) => /ArkTS|JavaScript|TypeScript|Python|Java\b|C\+\+|C#|Go\b|Rust/i.test(value || '')) || '';
    const title = stem.split('\n').map((line) => line.trim()).find((line) => line && !marker.test(line) && !/^\d+[、.]?$/.test(line))?.slice(0, 200) || stem.slice(0, 100);
    const pageUrl = `${location.origin}${location.pathname}`;
    const questionId = `${pageUrl}#${hash(JSON.stringify([type, stem, options, fields, language]))}`;

    function codeEditor() {
      const bindings = [];
      let unavailable = 0;
      const editorError = (message, code) => Object.assign(new Error(message), { code });
      for (const el of editorRoots) {
        let binding = null;
        if (el.classList.contains('ace_editor')) {
          // ace.edit 是工厂 API：换题期间调用会创建空编辑器。这里只读取站点已初始化的实例。
          const editor = el.env?.editor;
          if (editor?.getReadOnly?.()) continue;
          if (editor?.getValue && editor?.setValue && (!editor.container || editor.container === el)) {
            const session = editor.session || editor.getSession?.();
            binding = { owner: session || editor, kind: 'Ace', get: () => editor.getValue(), set: (code) => editor.setValue(code, -1), append: (chunk) => {
              if (session?.insert && session.getLength && session.getLine) { const row = session.getLength() - 1; session.insert({ row, column: session.getLine(row).length }, chunk); }
              else editor.setValue(editor.getValue() + chunk, -1);
            } };
          }
        } else if (el.classList.contains('monaco-editor')) {
          const api = globalThis.monaco?.editor;
          const instance = api?.getEditors?.().find((editor) => editor.getDomNode() === el);
          const readOnlyOption = globalThis.monaco?.editor?.EditorOption?.readOnly;
          if (instance?.getRawOptions?.().readOnly || (readOnlyOption !== undefined && instance?.getOption?.(readOnlyOption))) continue;
          // 全局 getModels 可能包含旧题或其他标签，必须使用与可见 DOM 关联的实例模型。
          const model = instance?.getModel();
          if (model && !model.isDisposed?.()) binding = { owner: model, kind: 'Monaco', get: () => model.getValue(), set: (code) => model.setValue(code), append: (chunk) => {
            if (model.applyEdits && model.getPositionAt) { const end = model.getPositionAt(model.getValue().length); model.applyEdits([{ range: { startLineNumber: end.lineNumber, startColumn: end.column, endLineNumber: end.lineNumber, endColumn: end.column }, text: chunk }]); }
            else model.setValue(model.getValue() + chunk);
          } };
        } else if (el.CodeMirror) {
          const cm = el.CodeMirror;
          if (cm.getOption?.('readOnly')) continue;
          binding = { owner: cm.getDoc?.() || cm, kind: 'CodeMirror 5', get: () => cm.getValue(), set: (code) => cm.setValue(code), append: (chunk) => {
            if (cm.replaceRange && cm.posFromIndex) { const end = cm.posFromIndex(cm.getValue().length); cm.replaceRange(chunk, end, end, '+nexly'); }
            else cm.setValue(cm.getValue() + chunk);
          } };
        } else if (el.matches('textarea') && !el.disabled && !el.readOnly) {
          binding = { owner: el, kind: 'textarea', get: () => el.value, set: (code) => setInput(el, code) };
        }
        if (binding) bindings.push({ ...binding, el }); else unavailable++;
      }
      // 只读预览和非活动标签已排除；仍有多个可写区域时不按内容长度或非空值猜测。
      if (bindings.length + unavailable > 1) throw editorError('仍有多个活动代码区域，等待页面完成编辑器切换', 'EDITOR_AMBIGUOUS');
      if (!bindings.length) throw editorError('当前题目的编辑器正在初始化或尚未暴露可验证 API', 'EDITOR_NOT_READY');
      const binding = bindings[0];
      const registry = globalThis.__nexlyEditorBindings ||= new WeakMap();
      let saved = registry.get(binding.el);
      if (!saved || saved.owner !== binding.owner) { saved = { owner: binding.owner, token: crypto.randomUUID() }; registry.set(binding.el, saved); }
      return { ...binding, token: saved.token };
    }
    function setInput(el, value) {
      if (el.disabled || el.readOnly) throw new Error('答案区域当前不可编辑，请等待页面允许输入');
      if (el.isContentEditable) el.textContent = value;
      else {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    let editorInfo = { kind: '', supported: true, code: '', error: '' };
    if (type === 'code') {
      try { const editor = codeEditor(); editorInfo = { kind: editor.kind, supported: true, code: editor.get(), binding: editor.token, retryable: false, error: '' };
        if (all('[aria-busy="true"],.ant-spin-spinning,.el-loading-mask', root).length) editorInfo = { ...editorInfo, supported: false, retryable: true, error: '正在等待当前题目加载完成' }; }
      catch (error) { editorInfo = { kind: editorRoots[0]?.className || 'unknown', supported: false, retryable: true, code: '', error: error.message, errorCode: error.code }; }
    }
    const question = { questionId, title, type, stem, options: type === 'code' ? [] : options, fields, language: normalize(language).slice(0, 100), starterCode: editorInfo.code, pageUrl };
    if (action === 'read') return readResult({ ok: true, question, editor: { kind: editorInfo.kind, supported: editorInfo.supported, error: editorInfo.error, retryable: editorInfo.retryable === true, binding: editorInfo.binding || null }, run: runInfo(), visible: document.visibilityState === 'visible' });
    if (!payload.allowBackground && document.visibilityState !== 'visible') return action === 'fillStep' ? { ok: true, waitingForFocus: true } : { ok: false, error: '练习页已隐藏，已停止页面操作；请回到原标签后继续' };
    if (payload.questionId !== questionId) return { ok: false, error: '页面题目已变化，拒绝把旧答案写入新题' };

    if (type === 'code' && ['fillStep', 'fill', 'run'].includes(action)) {
      if (!editorInfo.supported) return { ok: true, waiting: true, detail: editorInfo.error };
      if (payload.editorBinding && editorInfo.binding !== payload.editorBinding) throw new Error('编辑器实例或代码文件已切换，停止旧输入，请重新读取当前题');
    }

    if (action === 'fillStep') {
      const answer = payload.answer;
      if (!answer || answer.questionId !== questionId || answer.type !== type) throw new Error('答案与当前题目不匹配');
      const pacing = payload.pacing || { typewriter: false, typingIntervalMs: 0 };
      const progress = payload.progress || { started: false, offset: 0, fieldIndex: 0, step: 0 };
      const interval = pacing.typewriter ? pacing.typingIntervalMs : 0;
      if (!Number.isInteger(interval) || interval < 0 || interval > 500) throw new Error('输入间隔无效');
      const fragmentSize = interval ? Math.max(1, Math.floor(120 / interval)) : Infinity;
      const normalizeCode = (value) => value.replace(/\r\n/g, '\n');
      // 回读与注入之间仍可能有人编辑；首片段在页面内再次比对，不能覆盖这段间隙的人工修改。
      if (type === 'code' && !progress.started && typeof payload.expectedCode === 'string' && normalizeCode(editorInfo.code) !== normalizeCode(payload.expectedCode)) throw new Error('修正写入前代码已被人工更改，停止以避免覆盖你的编辑');
      const ensureUnchanged = () => {
        if (questionText() !== stem || !root.isConnected) throw new Error('输入期间页面或题目已变化，已停止');
      };
      async function writeFragment(get, set, append, target, typed) {
        let offset = progress.offset;
        if (!Number.isInteger(offset) || offset < 0 || offset > target.length) throw new Error('输入进度无效');
        const startingValue = get();
        let wrote = false;
        if (!progress.started) offset = 0;
        if (progress.started && get() !== target.slice(0, offset)) throw new Error('输入区域被其他操作改动，已停止，避免覆盖你的编辑');
        const characters = Array.from(target.slice(offset));
        const fragment = typed ? characters.slice(0, fragmentSize) : characters;
        for (const char of typed && fragment.length ? fragment : [fragment.join('')]) {
          if (typed && interval) await new Promise((resolve) => setTimeout(resolve, interval));
          if (!payload.allowBackground && document.visibilityState !== 'visible') break;
          ensureUnchanged();
          if ((!progress.started && offset === 0 ? get() !== startingValue : get() !== target.slice(0, offset))) throw new Error('输入期间内容发生变化，已停止');
          // 首个字符与模板替换一次完成，避免先清空、再等待时留下一块空白编辑器。
          if (!progress.started && offset === 0) set(char);
          else if (append) append(char); else set(target.slice(0, offset) + char);
          wrote = true;
          offset += char.length;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
        if ((!progress.started && !wrote ? get() !== startingValue : get() !== target.slice(0, offset))) throw new Error('逐字输入回读不一致，请检查编辑器');
        return offset;
      }
      if (type === 'code') {
        const editor = codeEditor(), target = normalizeCode(answer.code);
        const boundGet = () => { if (!editor.el.isConnected || !visible(editor.el) || codeEditor().token !== editor.token) throw new Error('输入期间编辑器已切换，停止旧输入'); return normalizeCode(editor.get()); };
        const offset = await writeFragment(boundGet, editor.set, editor.append, target, Boolean(pacing.typewriter && interval));
        const done = offset === target.length;
        return { ok: true, done, verified: done, waitingForFocus: !payload.allowBackground && document.visibilityState !== 'visible', progress: { started: offset > 0 || target.length === 0, offset, fieldIndex: 0, step: progress.step + 1 }, written: offset, total: target.length, nextAction: false, detail: done ? `已通过 ${editor.kind} 输入并回读代码` : '' };
      }
      if (['single', 'multiple', 'judge'].includes(type)) {
        const desired = new Set(answer.choiceIds);
        if (!desired.size || [...desired].some((id) => !options.some((option) => option.id === id))) throw new Error('选项标识无效');
        const index = optionNodes.findIndex((node, i) => optionSelected(node) !== desired.has(`option-${i}`) && (type === 'multiple' || desired.has(`option-${i}`)));
        let verified = true;
        if (index >= 0) {
          const node = optionNodes[index];
          if (node.disabled || node.getAttribute('aria-disabled') === 'true') return { ok: true, waiting: true, detail: '选项暂不可操作' };
          const applied = await applyOption(index, desired.has(`option-${index}`));
          if (!applied.ok) throw new Error('页面没有接受选项变更，请检查该站的选项控件');
          verified = applied.verified;
        }
        // 单选框没有多选语义：只要目标项读回已选中就收尾；完全读不到状态时按点击结果继续，由 detail 提示人工核对。
        const done = liveDone(desired) || (!verified && index >= 0);
        return { ok: true, done, verified: done && verified, progress: { ...progress, step: progress.step + 1 }, nextAction: true, detail: done ? (verified ? '已核对页面实际选中状态' : '页面没有暴露选中状态，已按点击结果继续，请人工核对') : '' };
      }
      const fieldIndex = progress.fieldIndex;
      if (!Number.isInteger(fieldIndex) || fieldIndex < 0 || fieldIndex >= fields.length || answer.fills.length !== fields.length) throw new Error('填写字段不匹配');
      const field = fields[fieldIndex], node = inputNodes[fieldIndex], fill = answer.fills.find((item) => item.fieldId === field.id);
      if (!fill) throw new Error('答案字段缺失');
      const get = () => node.isContentEditable ? node.textContent : node.value;
      // 数值控件可能拒绝中间态（例如 3.），因此整值写入；文本和代码可逐字输入。
      const offset = await writeFragment(get, (value) => setInput(node, value), null, fill.value, Boolean(pacing.typewriter && interval && node.type !== 'number'));
      const fieldDone = offset === fill.value.length;
      const done = fieldDone && fieldIndex === fields.length - 1;
      if (done) for (const item of answer.fills) {
        const el = inputNodes[fields.findIndex((entry) => entry.id === item.fieldId)];
        if (!el || (el.isContentEditable ? el.textContent : el.value) !== item.value) throw new Error('填写内容回读不一致');
      }
      return { ok: true, done, verified: done, waitingForFocus: !payload.allowBackground && document.visibilityState !== 'visible', progress: { started: !fieldDone && offset > 0, offset: fieldDone ? 0 : offset, fieldIndex: fieldDone ? fieldIndex + 1 : fieldIndex, step: progress.step + 1 }, written: fieldIndex + (fieldDone ? 1 : 0), total: fields.length, nextAction: fieldDone, detail: done ? '已核对所有填写字段的实际值' : '' };
    }

    if (action === 'fill') {
      const answer = payload.answer;
      if (!answer || answer.questionId !== questionId || answer.type !== type) throw new Error('答案与当前题目不匹配');
      if (type === 'code') {
        const editor = codeEditor();
        editor.set(answer.code);
        await new Promise((resolve) => setTimeout(resolve, 40));
        if (editor.get().replace(/\r\n/g, '\n') !== answer.code.replace(/\r\n/g, '\n')) throw new Error('代码写入后回读不一致，请手动核对；未提交');
        return { ok: true, verified: true, detail: `已通过 ${editor.kind} 整段替换并回读代码` };
      }
      if (['single', 'multiple', 'judge'].includes(type)) {
        const desired = new Set(answer.choiceIds);
        if (!desired.size || [...desired].some((id) => !options.some((option) => option.id === id))) throw new Error('选项标识无效');
        let verified = true;
        for (let i = 0; i < optionNodes.length; i++) {
          const node = optionNodes[i], wanted = desired.has(`option-${i}`);
          if (optionSelected(node) !== wanted && (wanted || type === 'multiple')) {
            if (node.disabled || node.getAttribute('aria-disabled') === 'true') throw new Error('选项暂不可操作');
            const applied = await applyOption(i, wanted);
            if (!applied.ok) throw new Error('页面没有接受选项变更，请检查该站的选项控件');
            verified &&= applied.verified;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        const checked = selectedIds();
        const matched = checked != null && checked.length === desired.size && checked.every((id) => desired.has(id));
        if (!matched && verified) throw new Error('页面没有接受全部选项变更，请人工检查');
        return { ok: true, verified: matched, detail: matched ? '已核对页面实际选中状态' : '页面没有暴露选中状态，已按点击结果填入，请人工核对' };
      }
      if (answer.fills.length !== fields.length) throw new Error('填写字段数量不匹配');
      for (const fill of answer.fills) {
        const index = fields.findIndex((field) => field.id === fill.fieldId);
        if (index < 0) throw new Error('填写字段不存在');
        setInput(inputNodes[index], fill.value);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
      for (const fill of answer.fills) {
        const node = inputNodes[fields.findIndex((field) => field.id === fill.fieldId)];
        if ((node.isContentEditable ? node.textContent : node.value) !== fill.value) throw new Error('填写内容回读不一致，请人工检查');
      }
      return { ok: true, verified: true, detail: '已核对所有填写字段的实际值' };
    }

    function executionResult() {
      const panels = all('[role="tabpanel"],.ant-tabs-tabpane,.execution-result,.test-results,[data-nexly-result]', root)
        .filter((el) => {
          const pane = el.closest('[role="tabpanel"],.ant-tabs-tabpane'), labelId = pane?.getAttribute('aria-labelledby');
          const label = pane?.getAttribute('aria-label') || (labelId ? labelId.split(/\s+/).map((id) => text(document.getElementById(id))).join(' ') : '');
          return !/提交|历史|submission|history/i.test(label);
        })
        .filter((el) => /测试输出|预期输出|实际输出|编译错误|编译失败|运行错误|运行超时|执行结果|Wrong Answer|Compilation Error|Runtime Error/i.test(text(el)) || el.matches('[data-nexly-result],.execution-result'));
      const explicit = panels.filter((el) => el.matches('[data-nexly-result],.execution-result'));
      const candidates = explicit.length ? explicit : panels;
      // 保留同一结果区域的状态标题和嵌套输出，不把子输出面板单独当结果而丢掉“编译错误”。
      const outer = candidates.filter((el) => !candidates.some((other) => other !== el && other.contains(el)));
      // 多个独立可见结果面板时不猜测，更不能把“提交结果”里的旧日志用作本次执行反馈。
      if (outer.length !== 1) return { result: '', fingerprint: '', summary: '', outcome: 'unknown', loading: false };
      const panel = outer[0], raw = String(panel.innerText || panel.textContent || '').replace(/\u00a0/g, ' ').trim();
      const statuses = all('[data-nexly-status],.execution-status,.result-status,[role="status"]', panel);
      // 错误关键字只在状态标题中判断：程序正常输出 "Error" 时不能误判为运行错误。
      const header = statuses.length === 1 ? text(statuses[0]) : raw.split(/测试输入|测试输出|预期输出|实际输出|期望输出|标准输入|标准输出|Input:|Output:|Expected:/i)[0].replace(/^(?:执行结果|运行结果)\s*[:：]?\s*/, '');
      const summary = normalize(header).slice(0, 180);
      const ratio = header.match(/(?:通过率|pass(?:ed)? rate)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%/i), count = header.match(/(\d+)\s*[/／]\s*(\d+)\s*(?:个)?(?:用例|样例|tests?)?\s*(?:通过|passed)/i);
      const partial = (ratio && Number(ratio[1]) < 100) || (count && Number(count[1]) < Number(count[2]));
      const failed = partial || /不通过|未通过|失败|错误|超时|异常|超出.*限制|Wrong Answer|(?:Compilation|Compile|Runtime|Syntax) Error|Time Limit Exceeded|Memory Limit Exceeded|Not Accepted|\bFailed\b|\berror\s+TS\d+|\b(?:TypeError|SyntaxError|ReferenceError)\b|Traceback \(most recent call last\)|^\s*Error\b/i.test(header);
      const passed = /通过|\bAccepted\b|\bSuccess\b|\bPassed\b/i.test(header) && !(count && Number(count[2]) === 0);
      const loading = /编译中|运行中|执行中|等待.*结果|正在(?:编译|运行|执行)|\bRunning\b|\bCompiling\b|\bPending\b/i.test(header);
      // 与 contracts.LIMITS.executionResult 一致；截断只影响日志，绝不截断实际执行代码。
      const suffix = '\n[执行日志过长，已截断]';
      return { result: raw.length > 16000 ? raw.slice(0, 16000 - suffix.length) + suffix : raw, fingerprint: `${raw.length}:${hash(raw)}`, summary, outcome: failed ? 'failed' : passed ? 'passed' : 'unknown', hasDetails: raw !== header.trim() || /error\s*(?:TS\d+|:)|Exception:|Traceback/i.test(raw), loading };
    }
    if (action === 'run') {
      const entry = runEntry();
      if (type !== 'code') return { ok: false, error: '当前不是编程题，不会执行或验证代码' };
      if (!entry.available) return { ok: false, error: entry.reason === 'ambiguous' ? '页面存在多个同级执行入口，无法确定目标；不会用“提交”按钮代替' : '没有找到唯一的“执行代码/执行验证”入口；不会用“提交”按钮代替' };
      if (entry.disabled) return { ok: true, waiting: true, detail: '执行按钮暂不可用，等待平台恢复' };
      if (codeEditor().get().replace(/\r\n/g, '\n') !== payload.code.replace(/\r\n/g, '\n')) throw new Error('编辑器内容已变化，停止运行');
      releaseSampleRun(globalThis.__nexlySampleRun);
      const previous = executionResult(), code = codeEditor().get();
      const tracker = { token: crypto.randomUUID(), questionId, binding: editorInfo.binding, code, previous: previous.fingerprint, last: previous.fingerprint, lastLoading: false, changed: false, sawLoading: false, changedAt: Date.now() };
      globalThis.__nexlySampleRun = tracker;
      const observe = () => {
        const current = executionResult(), currentEntry = runEntry();
        const loading = current.loading || (currentEntry.available && currentEntry.disabled);
        tracker.sawLoading ||= loading;
        tracker.changed ||= current.fingerprint !== tracker.previous;
        if (current.fingerprint !== tracker.last || loading !== tracker.lastLoading) tracker.changedAt = Date.now();
        tracker.last = current.fingerprint; tracker.lastLoading = loading;
      };
      // 在点击前监听，捕获两次轮询之间短暂的清空/加载，支持“新一轮仍返回相同错误”。
      if (typeof MutationObserver === 'function') {
        tracker.observer = new MutationObserver(observe);
        tracker.observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'aria-disabled', 'aria-busy', 'class', 'hidden', 'style', 'aria-selected'] });
        tracker.timer = setTimeout(() => releaseSampleRun(tracker), 65000);
      }
      try { entry.element.click(); observe(); } catch (error) { releaseSampleRun(tracker); throw error; }
      return { ok: true, clicked: true, runToken: tracker.token };
    }
    if (action === 'runStatus') {
      const tracker = globalThis.__nexlySampleRun;
      if (!tracker || tracker.token !== payload.runToken || tracker.questionId !== questionId) throw new Error('执行记录已失效，拒绝读取旧结果');
      if (editorInfo.errorCode === 'EDITOR_AMBIGUOUS') throw new Error('执行期间出现多个活动代码区域，停止自动修正，请人工检查');
      // 执行时站点会临时设为只读、遮罩或隐藏编辑器；不可读/不可写不等于代码被修改。
      // 保留本次执行记录并等待原实例恢复，恢复后仍须逐字核对，不能据此重绑其他文件或解除只读。
      const waitingForEditor = !editorInfo.supported;
      if (!waitingForEditor && editorInfo.binding !== tracker.binding) throw new Error('执行期间编辑器实例或代码文件已切换，停止自动修正，请人工检查');
      if (!waitingForEditor && editorInfo.code.replace(/\r\n/g, '\n') !== tracker.code.replace(/\r\n/g, '\n')) throw new Error('执行期间代码已变化，停止自动修正，请人工检查');
      const entry = runEntry(), current = executionResult(), loading = waitingForEditor || !entry.available || entry.disabled || current.loading;
      // 编辑器不可用本身不证明产生了新结果，避免把原有错误日志误送给模型。
      tracker.sawLoading ||= current.loading || (entry.available && entry.disabled);
      tracker.changed ||= current.fingerprint !== tracker.previous;
      if (current.fingerprint !== tracker.last || loading !== tracker.lastLoading) tracker.changedAt = Date.now();
      tracker.last = current.fingerprint; tracker.lastLoading = loading;
      return { ok: true, ...current, loading, waitingForEditor, fresh: tracker.changed || tracker.sawLoading, stable: Date.now() - tracker.changedAt >= 350, code: tracker.code };
    }
    return { ok: false, error: '不支持的页面操作' };
  } catch (error) {
    return { ok: false, error: `页面操作未能完成：${error?.message || error}` };
  }
}
