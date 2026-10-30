// Automatic runtime-only text clarity for accessible message frames. No card source, navigation or settings writes.
const TEXT_CSS = 'html body, html body *, html body *::before, html body *::after { text-shadow: none !important; }';

export function createCardTextClarity(chat) {
    let enabled = false, observer = null, pending = 0;
    const frames = new Map(), floating = new Set();
    const doc = chat.ownerDocument;
    // Host shells already have their own styles. Inspect external mounts, not whole application trees.
    const hostShells = '#top-bar, #top-settings-holder, #sheld, #chat, #form_sheld, #extensions_settings, #extensions_settings2, #extensionsMenu, #options, #toast-container, #character_popup, #world_popup, #ilg-home, #ilg-fold-menu';
    function findFloating() {
        const found = new Set();
        const walk = el => {
            if (el.matches(hostShells + ', script, style, link, meta, svg, canvas')) return;
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || el.hidden || el.getAttribute('aria-hidden') === 'true') return;
            const semantic = el.matches('dialog, [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [popover]');
            if ((semantic || cs.position === 'fixed') && cs.display !== 'none' && cs.visibility !== 'hidden' && !el.hidden && el.getAttribute('aria-hidden') !== 'true') {
                const box = el.getBoundingClientRect();
                if (box.width > 0 && box.height > 0) { found.add(el); return; }
            }
            if (el.matches('iframe')) return;
            for (const child of el.children) walk(child);
        };
        for (const child of doc.body.children) walk(child);
        for (const el of floating) if (!found.has(el)) { el.classList.remove('ilg-floating-clarity'); floating.delete(el); }
        for (const el of found) { el.classList.add('ilg-floating-clarity'); floating.add(el); }
    }
    function relevant(mutation) {
        const el = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
        if (!el) return false;
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
            const clean = value => (value || '').split(/\s+/).filter(c => c && c !== 'ilg-floating-clarity').sort().join(' ');
            if (clean(mutation.oldValue) === clean(el.getAttribute('class'))) return false;
        }
        // 聊天区里只有“插入/删除了 iframe”才值得重扫；纯文本流式输出、消息增删都跳过
        if (el.closest('#chat')) {
            if (mutation.type !== 'childList') return false;
            const hit = n => n.nodeType === 1 && (n.matches('iframe') || !!n.querySelector?.('iframe'));
            return [...mutation.addedNodes, ...mutation.removedNodes].some(hit);
        }
        if (el.closest(hostShells + ', script, style, svg')) return false;
        // 带浮层语义的节点增删才扫；普通 class 变化（按钮高亮、输入焦点）不扫
        if (mutation.type === 'attributes') return el.matches('dialog, [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [popover]');
        return true;
    }
    // 只关心“可见浮层 / iframe 出现或消失”，这类变化很稀疏；正文打字、流式输出不该触发整页扫描。
    // 用 requestIdleCallback 兜底：浏览器忙（流式输出 / 滚动）时自动让路，闲下来才扫。
    const idle = window.requestIdleCallback || (cb => setTimeout(() => cb({ didTimeout: true }), 300));
    const schedule = () => {
        if (enabled && !pending) pending = idle(refresh, { timeout: 1200 }) || 1;
    };
    function detachDocument(entry) {
        entry.observer?.disconnect();
        entry.observer = null;
        entry.style?.remove();
        entry.style = null;
        entry.document = null;
    }
    function dispose(frame, entry) {
        frame.removeEventListener('load', entry.onLoad);
        detachDocument(entry);
        frames.delete(frame);
    }
    function refresh() {
        pending = 0;
        if (!enabled) return;
        findFloating();
        const seen = new Set();
        const visit = frame => {
            if (seen.has(frame)) return;
            seen.add(frame);
            let entry = frames.get(frame);
            if (!entry) {
                entry = { document: null, style: null, observer: null, onLoad: null };
                entry.onLoad = () => { detachDocument(entry); schedule(); };
                frame.addEventListener('load', entry.onLoad);
                frames.set(frame, entry);
            }
            // Avoid probing known opaque/cross-origin frames; some WebKit builds report even a caught probe.
            const sandbox = frame.getAttribute('sandbox');
            let accessible = sandbox === null || frame.sandbox.contains('allow-same-origin');
            if (accessible && !frame.hasAttribute('srcdoc')) {
                try {
                    const source = new URL(frame.getAttribute('src') || 'about:blank', frame.ownerDocument.baseURI);
                    accessible = source.href === 'about:blank' || source.origin === (frame.ownerDocument.defaultView?.origin || frame.ownerDocument.location.origin);
                } catch { accessible = false; }
            }
            if (!accessible) { detachDocument(entry); return; }
            let doc;
            try { doc = frame.contentDocument; } catch { /* Origin isolation remains intact. */ }
            if (!doc?.documentElement) { detachDocument(entry); return; }
            if (entry.document !== doc) {
                detachDocument(entry);
                entry.document = doc;
                entry.observer = new MutationObserver(mutations => {
                    if (mutations.some(m => [...m.addedNodes, ...m.removedNodes].some(n =>
                        n.nodeType === 1 && (n === entry.style || n.contains(entry.style) || n.matches('iframe') || n.querySelector('iframe'))
                    ))) schedule();
                });
                entry.observer.observe(doc, { childList: true, subtree: true });
            }
            if (!entry.style?.isConnected) {
                const style = doc.createElement('style');
                style.dataset.ilgCardClarity = '1';
                style.textContent = TEXT_CSS;
                entry.style = style;
                (doc.head || doc.documentElement).append(style);
            }
            doc.querySelectorAll('iframe').forEach(visit);
        };
        chat.querySelectorAll('.mes_text iframe').forEach(visit);
        for (const el of floating) {
            if (el.matches('iframe')) visit(el);
            el.querySelectorAll('iframe').forEach(visit);
        }
        for (const [frame, entry] of frames) if (!seen.has(frame)) dispose(frame, entry);
    }
    function setEnabled(value) {
        const next = value === true;
        if (next === enabled) return;
        enabled = next;
        if (enabled) {
            observer = new MutationObserver(mutations => { if (mutations.some(relevant)) schedule(); });
            observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden'] });
            refresh();
        } else {
            observer?.disconnect();
            observer = null;
            if (pending) (window.cancelIdleCallback ? cancelIdleCallback(pending) : cancelAnimationFrame(pending));
            pending = 0;
            for (const [frame, entry] of frames) dispose(frame, entry);
            for (const el of floating) el.classList.remove('ilg-floating-clarity');
            floating.clear();
        }
    }
    return { setEnabled, destroy: () => setEnabled(false) };
}
