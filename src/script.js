if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
}

const STORAGE_KEY = 'bunko-novel-editor:v4';
const FONT_STACKS = {
    mincho: '"Yu Mincho", "Noto Serif JP", "Hiragino Mincho ProN", "BIZ UDPMincho", serif',
    gothic: '"Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", Meiryo, sans-serif'
};
const PAGE_BREAK_PATTERN = /^\s*(?:［改ページ］|［＃改ページ］|［＃改丁］|\[page\]|={3,5}|-{3,5})\s*$/i;
const DEFAULT_TITLE = '作品タイトル';
const DEFAULT_AUTHOR = '著者名';
const DEFAULT_TEXT = [
    '　ここから本文を書き始めます。',
    '',
    '　このエディタはA6文庫サイズで縦書きに組み、ページごとに左右の余白を持たせます。',
    '',
    '　ルビは|漢字《かんじ》や|漢字<<かんじ>>、強調は**太字**や*イタリック*で書けます。',
    '［改ページ］',
    '　改ページを入れると、次のA6ページに続きます。'
].join('\n');

const editor = document.getElementById('editor');
const titleInput = document.getElementById('titleInput');
const authorInput = document.getElementById('authorInput');
const previewPane = document.getElementById('previewPane');
const statusText = document.getElementById('status');
const loadTextButton = document.getElementById('loadTextButton');
const pageBreakButton = document.getElementById('pageBreakButton');
const downloadTextButton = document.getElementById('downloadTextButton');
const printButton = document.getElementById('printButton');
const txtFileInput = document.getElementById('txtFileInput');

const toggleSettingsButton = document.getElementById('toggleSettingsButton');
const settingsPanel = document.getElementById('settingsPanel');
const coverPosSelect = document.getElementById('coverPos');
const coverAlignSelect = document.getElementById('coverAlign');
const titleSizeSelect = document.getElementById('titleSize');
const authorSizeSelect = document.getElementById('authorSize');
const authorPrefixInput = document.getElementById('authorPrefix');
const coverWritingModeSelect = document.getElementById('coverWritingMode');
const bodyFontSelect = document.getElementById('bodyFont');
const bodyOrientationSelect = document.getElementById('bodyOrientation');
const printSizeSelect = document.getElementById('printSize');

let renderTimer = 0;

function applyBodySettings() {
    document.documentElement.style.setProperty('--body-font-family', FONT_STACKS[bodyFontSelect.value] || FONT_STACKS.mincho);
    document.documentElement.style.setProperty('--text-orientation', bodyOrientationSelect.value);
}

function applyPrintSettings() {
    const is4up = printSizeSelect.value === 'a4-4up';
    document.body.classList.toggle('mode-a4-4up', is4up);

    let styleTag = document.getElementById('print-size-style');
    if (!styleTag) {
        styleTag = document.createElement('style');
        styleTag.id = 'print-size-style';
        document.head.appendChild(styleTag);
    }

    if (is4up) {
        styleTag.textContent = '@media print { @page { size: 210mm 297mm; } }';
    } else {
        styleTag.textContent = '@media print { @page { size: 105mm 148.5mm; } }';
    }
}

function loadState() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        if (saved && typeof saved.text === 'string') {
            titleInput.value = saved.title || '';
            authorInput.value = saved.author || '';
            editor.value = saved.text;

            if (saved.coverSettings) {
                coverPosSelect.value = saved.coverSettings.pos || 'pos-center';
                coverAlignSelect.value = saved.coverSettings.align || 'align-center';
                coverWritingModeSelect.value = saved.coverSettings.writingMode || 'wm-v';
                titleSizeSelect.value = saved.coverSettings.titleSize || 'ts-m';
                authorSizeSelect.value = saved.coverSettings.authorSize || 'as-m';
                authorPrefixInput.value = saved.coverSettings.authorPrefix || '';
            }
            if (saved.bodySettings) {
                bodyFontSelect.value = saved.bodySettings.font || 'mincho';
                bodyOrientationSelect.value = saved.bodySettings.orientation || 'mixed';
                printSizeSelect.value = saved.printSize || 'a6';
            }
            applyBodySettings();
            applyPrintSettings();
            return;
        }
    } catch (error) {
        console.warn('保存データを読めませんでした。', error);
    }
    titleInput.value = DEFAULT_TITLE;
    authorInput.value = DEFAULT_AUTHOR;
    editor.value = DEFAULT_TEXT;
    updateTabTitle();
}

function saveState() {
    const payload = {
        title: titleInput.value,
        author: authorInput.value,
        text: editor.value,
        coverSettings: {
            pos: coverPosSelect.value,
            align: coverAlignSelect.value,
            writingMode: coverWritingModeSelect.value,
            titleSize: titleSizeSelect.value,
            authorSize: authorSizeSelect.value,
            authorPrefix: authorPrefixInput.value
        },
        bodySettings: {
            font: bodyFontSelect.value,
            orientation: bodyOrientationSelect.value
        },
        printSize: printSizeSelect.value
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function updateTabTitle() {
    const title = titleInput.value.trim() || '作品タイトル';
    const author = authorInput.value.trim() || '著者';
    document.title = `　　${title}/${author} - 文庫小説エディタ　　`;
}

function normalizeText(text) {
    return text.replace(/\r\n?/g, '\n');
}

function isKanji(ch) {
    return /[一-龠々〆〇ヶ]/.test(ch);
}

function visibleCharacterCount(text) {
    return normalizeText(text)
        .split('\n')
        .filter(line => !PAGE_BREAK_PATTERN.test(line))
        .join('')
        .replace(/[｜|]([^《<>]+)(?:《[^》]+》|<<[^>]+>>)/g, '$1')
        .replace(/([一-龠々〆〇ヶ]+)《[^》]+》/g, '$1')
        .replace(/［＃[^］]+］/g, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/\s/g, '').length;
}

function createPage(pagesElement) {
    const page = document.createElement('article');
    page.className = 'page';

    const content = document.createElement('div');
    content.className = 'page-content';
    page.appendChild(content);
    pagesElement.appendChild(page);

    return { page, content };
}

function createCoverPage(pagesElement) {
    const page = document.createElement('article');
    page.className = 'page';

    const content = document.createElement('div');
    content.className = 'page-content';

    const cover = document.createElement('div');
    cover.className = `cover-layout ${coverWritingModeSelect.value} ${coverPosSelect.value} ${coverAlignSelect.value}`;

    const title = document.createElement('div');
    title.className = `cover-title ${titleSizeSelect.value}`;
    title.textContent = titleInput.value.trim();

    const author = document.createElement('div');
    author.className = `cover-author ${authorSizeSelect.value}`;
    const prefix = authorPrefixInput.value.trim() || '著者';
    author.textContent = authorInput.value.trim() ? `${prefix}　${authorInput.value.trim()}` : '';

    if (title.textContent === '' && author.textContent === '') {
        return null;
    }

    cover.appendChild(title);
    if (author.textContent !== '') {
        cover.appendChild(author);
    }
    content.appendChild(cover);
    page.appendChild(content);
    pagesElement.appendChild(page);
    return page;
}

function overflows(content) {
    return content.scrollWidth > content.clientWidth + 1 || content.scrollHeight > content.clientHeight + 1;
}

function createTokenNode(token) {
    if (token.type === 'br') {
        return document.createElement('br');
    }

    if (token.type === 'ruby') {
        const ruby = document.createElement('ruby');
        appendInlineTokens(ruby, parseInline(token.base));
        const rt = document.createElement('rt');
        appendInlineTokens(rt, parseInline(token.reading));
        ruby.appendChild(rt);
        return ruby;
    }

    if (token.type === 'bold') {
        const span = document.createElement('span');
        span.className = 'bold';
        appendInlineTokens(span, parseInline(token.text));
        return span;
    }

    if (token.type === 'italic') {
        const span = document.createElement('span');
        span.className = 'italic';
        appendInlineTokens(span, parseInline(token.text));
        return span;
    }

    return document.createTextNode(token.text);
}

function appendInlineTokens(parent, tokens) {
    const fragment = document.createDocumentFragment();
    for (const token of tokens) {
        fragment.appendChild(createTokenNode(token));
    }
    parent.appendChild(fragment);
}

function appendTokenRange(parent, tokens, start, count) {
    const fragment = document.createDocumentFragment();
    for (let i = start; i < start + count; i += 1) {
        fragment.appendChild(createTokenNode(tokens[i]));
    }
    parent.appendChild(fragment);
}

function setTokenRange(parent, tokens, start, count) {
    parent.replaceChildren();
    appendTokenRange(parent, tokens, start, count);
}

function setTokenRangeWithPartial(parent, tokens, start, count, partialToken) {
    parent.replaceChildren();
    appendTokenRange(parent, tokens, start, count);
    if (partialToken) {
        parent.appendChild(createTokenNode(partialToken));
    }
}

function maxFittingCount(paragraph, content, tokens, start, count) {
    let low = 0;
    let high = count;
    let best = 0;

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        setTokenRange(paragraph, tokens, start, mid);

        if (overflows(content)) {
            high = mid - 1;
        } else {
            best = mid;
            low = mid + 1;
        }
    }

    paragraph.replaceChildren();
    return best;
}

function maxFittingChars(paragraph, content, tokens, start, count, tokenToSplit) {
    const chars = Array.from(tokenToSplit.text);
    let low = 1;
    let high = chars.length;
    let best = 0;

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const partial = { type: 'text', text: chars.slice(0, mid).join('') };
        setTokenRangeWithPartial(paragraph, tokens, start, count, partial);

        if (overflows(content)) {
            high = mid - 1;
        } else {
            best = mid;
            low = mid + 1;
        }
    }
    paragraph.replaceChildren();
    return best;
}

function parseInline(text) {
    const tokens = [];
    const chars = Array.from(text);
    let buffer = '';

    function flushText() {
        if (buffer !== '') {
            tokens.push({ type: 'text', text: buffer });
            buffer = '';
        }
    }

    for (let i = 0; i < chars.length; i += 1) {
        const char = chars[i];
        if (char === '\n') {
            flushText();
            tokens.push({ type: 'br' });
            continue;
        }

        if ((char === '|' || char === '｜') && chars[i + 1]) {
            const angleOpen = chars.indexOf('《', i + 1);
            let chevronOpen = -1;
            for (let j = i + 1; j < chars.length - 1; j += 1) {
                if (chars[j] === '<' && chars[j + 1] === '<') {
                    chevronOpen = j;
                    break;
                }
            }

            let openIndex = -1;
            let openPattern = null;
            if (angleOpen !== -1 && (chevronOpen === -1 || angleOpen < chevronOpen)) {
                openIndex = angleOpen;
                openPattern = '《';
            } else if (chevronOpen !== -1) {
                openIndex = chevronOpen;
                openPattern = '<<';
            }

            if (openPattern && openIndex > i + 1) {
                flushText();
                const base = chars.slice(i + 1, openIndex).join('');
                const readingStart = openIndex + (openPattern === '<<' ? 2 : 1);
                let close = -1;

                if (openPattern === '<<') {
                    for (let j = readingStart; j < chars.length - 1; j += 1) {
                        if (chars[j] === '>' && chars[j + 1] === '>') {
                            close = j;
                            break;
                        }
                    }
                } else {
                    close = chars.indexOf('》', readingStart);
                }

                if (close > readingStart) {
                    tokens.push({
                        type: 'ruby',
                        base,
                        reading: chars.slice(readingStart, close).join('')
                    });
                    i = close + (openPattern === '<<' ? 1 : 0);
                    continue;
                }
            }
        }

        if (char === '《' && buffer.length > 0) {
            let j = buffer.length - 1;
            while (j >= 0 && isKanji(buffer[j])) {
                j--;
            }
            if (j < buffer.length - 1) {
                const base = buffer.slice(j + 1);
                const newBuffer = buffer.slice(0, j + 1);
                const close = chars.indexOf('》', i + 1);
                if (close !== -1) {
                    buffer = newBuffer;
                    flushText();
                    tokens.push({
                        type: 'ruby',
                        base: base.join ? base.join('') : base,
                        reading: chars.slice(i + 1, close).join('')
                    });
                    i = close;
                    continue;
                }
            }
        }

        if (char === '［' && chars[i + 1] === '＃') {
            const close = chars.indexOf('］', i + 1);
            if (close !== -1) {
                i = close;
                continue;
            }
        }

        if (char === '*' && chars[i + 1] === '*') {
            const close = chars.findIndex((char, index) => index > i + 1 && char === '*' && chars[index + 1] === '*');
            if (close > i + 1) {
                flushText();
                tokens.push({ type: 'bold', text: chars.slice(i + 2, close).join('') });
                i = close + 1;
                continue;
            }
        }

        if (chars[i] === '*') {
            const close = chars.indexOf('*', i + 1);
            if (close > i + 1) {
                flushText();
                tokens.push({ type: 'italic', text: chars.slice(i + 1, close).join('') });
                i = close;
                continue;
            }
        }

        buffer += chars[i];
    }

    flushText();
    return tokens;
}

function parseBlocks(text) {
    const lines = normalizeText(text).split('\n');
    const blocks = [];
    let paragraph = [];
    let skipNextBlank = false;
    const NOTE_ONLY_PATTERN = /^\s*［＃[^］]+］\s*$/;

    function flushParagraph() {
        if (paragraph.length > 0) {
            blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
            paragraph = [];
        }
    }

    for (const line of lines) {
        if (PAGE_BREAK_PATTERN.test(line)) {
            flushParagraph();
            blocks.push({ type: 'page-break' });
            skipNextBlank = true;
            continue;
        }

        // Skip lines that only contain Aozora notes (that aren't page breaks)
        if (NOTE_ONLY_PATTERN.test(line)) {
            continue;
        }

        if (line.trim() === '') {
            if (skipNextBlank) {
                skipNextBlank = false;
                continue;
            }
            flushParagraph();
            blocks.push({ type: 'blank' });
            continue;
        }

        skipNextBlank = false;
        paragraph.push(line);
    }

    flushParagraph();
    return blocks;
}

function paginate(text) {
    const workbench = document.createElement('div');
    workbench.className = 'pagination-workbench';

    const pagesElement = document.createElement('div');
    pagesElement.className = 'pages';
    pagesElement.id = 'pages';
    workbench.appendChild(pagesElement);
    document.body.appendChild(workbench);

    createCoverPage(pagesElement);
    let current = null;

    function ensurePage() {
        if (!current) {
            current = createPage(pagesElement);
        }
    }

    function pageIsEmpty() {
        return !current || (current.content.textContent === '' && !current.content.querySelector('br, ruby'));
    }

    function nextPage() {
        current = createPage(pagesElement);
    }

    function addBlankLine() {
        ensurePage();
        const paragraph = document.createElement('p');
        paragraph.className = 'empty-line';
        paragraph.appendChild(document.createElement('br'));
        current.content.appendChild(paragraph);

        if (overflows(current.content)) {
            current.content.removeChild(paragraph);
            nextPage();
            current.content.appendChild(paragraph);
        }
    }

    function addParagraph(textValue) {
        ensurePage();
        let tokens = parseInline(textValue);
        let index = 0;

        while (index < tokens.length) {
            const paragraph = document.createElement('p');
            current.content.appendChild(paragraph);

            const remaining = tokens.length - index;
            appendTokenRange(paragraph, tokens, index, remaining);

            if (!overflows(current.content)) {
                index = tokens.length;
                continue;
            }

            paragraph.replaceChildren();
            const fitCount = maxFittingCount(paragraph, current.content, tokens, index, remaining);

            const splitIndex = index + fitCount;
            if (splitIndex < tokens.length && tokens[splitIndex].type === 'text') {
                const fitChars = maxFittingChars(paragraph, current.content, tokens, index, fitCount, tokens[splitIndex]);
                if (fitChars > 0) {
                    const chars = Array.from(tokens[splitIndex].text);
                    const head = { type: 'text', text: chars.slice(0, fitChars).join('') };
                    const tail = { type: 'text', text: chars.slice(fitChars).join('') };

                    setTokenRangeWithPartial(paragraph, tokens, index, fitCount, head);
                    tokens[splitIndex] = tail;
                    index = splitIndex;
                    nextPage();
                    continue;
                }
            }

            if (fitCount > 0) {
                appendTokenRange(paragraph, tokens, index, fitCount);
                index += fitCount;
                if (index < tokens.length) {
                    nextPage();
                }
                continue;
            }

            current.content.removeChild(paragraph);
            if (pageIsEmpty()) {
                current.content.appendChild(paragraph);
                const token = tokens[index];
                if (token.type === 'text') {
                    const chars = Array.from(token.text);
                    const head = { type: 'text', text: chars[0] };
                    const tail = chars.length > 1 ? { type: 'text', text: chars.slice(1).join('') } : null;
                    paragraph.appendChild(createTokenNode(head));
                    if (tail) {
                        tokens[index] = tail;
                    } else {
                        index += 1;
                    }
                } else {
                    appendTokenRange(paragraph, tokens, index, 1);
                    index += 1;
                }
            }
            nextPage();
        }
    }

    for (const block of parseBlocks(text)) {
        if (block.type === 'page-break') {
            if (!pageIsEmpty()) {
                nextPage();
            }
            continue;
        }

        if (block.type === 'blank') {
            addBlankLine();
            continue;
        }

        addParagraph(block.text);
    }

    const pages = Array.from(pagesElement.children);
    if (pages.length === 0) {
        createPage(pagesElement);
    }

    Array.from(pagesElement.children).forEach((page, index) => {
        page.dataset.page = String(index + 1);
    });

    workbench.remove();
    return pagesElement;
}

function applyPreviewScale() {
    const scaler = document.getElementById('pagesScaler');
    const pages = document.getElementById('pages');
    if (!scaler || !pages) return;

    const firstEl = pages.firstElementChild;
    if (!firstEl) return;
    
    const unscaledPageWidth = firstEl.offsetWidth;
    const isMobile = window.innerWidth <= 920;
    const containerWidth = previewPane.clientWidth - (isMobile ? 24 : 60);

    if (containerWidth < unscaledPageWidth) {
        const scale = containerWidth / unscaledPageWidth;
        document.documentElement.style.setProperty('--preview-scale', scale.toString());
        scaler.style.width = (pages.offsetWidth * scale) + 'px';
        scaler.style.height = (pages.offsetHeight * scale) + 'px';
    } else {
        document.documentElement.style.setProperty('--preview-scale', '1');
        scaler.style.width = '';
        scaler.style.height = '';
    }
}

function renderPreview() {
    const pagesElement = paginate(editor.value);
    const pages = Array.from(pagesElement.children);
    const pageCount = pages.length;

    let finalPagesElement = pagesElement;

    if (printSizeSelect.value === 'a4-4up') {
        const sheetsContainer = document.createElement('div');
        sheetsContainer.className = 'pages';
        sheetsContainer.id = 'pages';

        for (let i = 0; i < pages.length; i += 4) {
            const sheet = document.createElement('div');
            sheet.className = 'sheet-a4';
            for (let j = 0; j < 4; j++) {
                if (pages[i + j]) {
                    sheet.appendChild(pages[i + j]);
                } else {
                    const filler = document.createElement('div');
                    filler.className = 'page filler';
                    sheet.appendChild(filler);
                }
            }
            sheetsContainer.appendChild(sheet);
        }
        finalPagesElement = sheetsContainer;
    }
    
    const scaler = document.createElement('div');
    scaler.id = 'pagesScaler';
    scaler.className = 'pages-scaler';
    scaler.appendChild(finalPagesElement);
    
    previewPane.replaceChildren(scaler);

    const charCount = visibleCharacterCount(editor.value);
    if (printSizeSelect.value === 'a4-4up') {
        const sheetCount = Math.ceil(pageCount / 4);
        statusText.textContent = `${pageCount}ページ (A4: ${sheetCount}枚) / ${charCount.toLocaleString('ja-JP')}字`;
    } else {
        statusText.textContent = `${pageCount}ページ / ${charCount.toLocaleString('ja-JP')}字`;
    }
    
    applyPreviewScale();
}

function queueRender() {
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(() => {
        renderPreview();
    }, 40);
}

function insertAtCursor(value) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const before = editor.value.slice(0, start);
    const after = editor.value.slice(end);
    const prefix = before.endsWith('\n') || before.length === 0 ? '' : '\n';
    const suffix = after.startsWith('\n') || after.length === 0 ? '' : '\n';
    const insertion = `${prefix}${value}${suffix}`;

    editor.value = before + insertion + after;
    const cursor = before.length + insertion.length;
    editor.focus();
    editor.setSelectionRange(cursor, cursor);
    saveState();
    queueRender();
}

function downloadText() {
    const titleStr = titleInput.value.trim();
    const authorStr = authorInput.value.trim();
    let content = '';
    if (titleStr) content += `タイトル：${titleStr}\n`;
    if (authorStr) content += `著者：${authorStr}\n`;
    
    // Cover settings
    content += `扉上下：${coverPosSelect.value}\n`;
    content += `扉左右：${coverAlignSelect.value}\n`;
    content += `扉方向：${coverWritingModeSelect.value}\n`;
    content += `題サイズ：${titleSizeSelect.value}\n`;
    content += `名サイズ：${authorSizeSelect.value}\n`;
    content += `名ラベル：${authorPrefixInput.value.trim()}\n`;
    content += `書体：${bodyFontSelect.value}\n`;
    content += `英数字：${bodyOrientationSelect.value}\n`;
    content += `面数：${printSizeSelect.value}\n`;

    if (titleStr || authorStr) content += '\n';
    content += editor.value;

    const filename = (titleStr || 'novel').replace(/[\\/:*?"<>|]/g, '_');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `${filename}.txt`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
}

function loadTextFile() {
    txtFileInput.value = '';
    txtFileInput.click();
}

txtFileInput.addEventListener('change', async () => {
    const file = txtFileInput.files && txtFileInput.files[0];
    if (!file) {
        return;
    }

    const buffer = await file.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(buffer);

    // Replacement character check (U+FFFD) to detect encoding mismatch
    const replacementCount = (text.match(/\uFFFD/g) || []).length;
    if (replacementCount > text.length * 0.01) {
        text = new TextDecoder('shift-jis').decode(buffer);
    }

    text = normalizeText(text);
    const lines = text.split('\n');
    let bodyStartIndex = 0;
    let foundTitle = '';
    let foundAuthor = '';
    const foundCoverSettings = {};

    const isAozora = text.includes('［＃') || text.includes('｜') || text.includes('《') || text.includes('底本：');

    // Aozora Bunko style: line 1 is Title, line 2 is Author (if no prefix and it looks like Aozora)
    if (isAozora && lines.length > 3 && !lines[0].includes('：') && !lines[1].includes('：')) {
        foundTitle = lines[0].trim();
        foundAuthor = lines[1].trim();
        bodyStartIndex = 2;
    } else {
        for (let i = 0; i < Math.min(lines.length, 20); i++) {
            const line = lines[i].trim();
            const titleMatch = line.match(/^(?:タイトル|作品名)[\:：]\s*(.*)$/);
            const authorMatch = line.match(/^(?:著者|作者)[\:：]\s*(.*)$/);
            
            const coverPosMatch = line.match(/^扉上下[\:：]\s*(.*)$/);
            const coverAlignMatch = line.match(/^扉左右[\:：]\s*(.*)$/);
            const coverWritingModeMatch = line.match(/^扉方向[\:：]\s*(.*)$/);
            const titleSizeMatch = line.match(/^題サイズ[\:：]\s*(.*)$/);
            const authorSizeMatch = line.match(/^名サイズ[\:：]\s*(.*)$/);
            const authorPrefixMatch = line.match(/^名ラベル[\:：]\s*(.*)$/);
            const bodyFontMatch = line.match(/^書体[\:：]\s*(.*)$/);
            const bodyOrientationMatch = line.match(/^英数字[\:：]\s*(.*)$/);
            const printSizeMatch = line.match(/^面数[\:：]\s*(.*)$/);

            if (titleMatch) {
                foundTitle = titleMatch[1];
                bodyStartIndex = i + 1;
            } else if (authorMatch) {
                foundAuthor = authorMatch[1];
                bodyStartIndex = i + 1;
            } else if (coverPosMatch) {
                foundCoverSettings.pos = coverPosMatch[1];
                bodyStartIndex = i + 1;
            } else if (coverAlignMatch) {
                foundCoverSettings.align = coverAlignMatch[1];
                bodyStartIndex = i + 1;
            } else if (coverWritingModeMatch) {
                foundCoverSettings.writingMode = coverWritingModeMatch[1];
                bodyStartIndex = i + 1;
            } else if (titleSizeMatch) {
                foundCoverSettings.titleSize = titleSizeMatch[1];
                bodyStartIndex = i + 1;
            } else if (authorSizeMatch) {
                foundCoverSettings.authorSize = authorSizeMatch[1];
                bodyStartIndex = i + 1;
            } else if (authorPrefixMatch) {
                foundCoverSettings.authorPrefix = authorPrefixMatch[1];
                bodyStartIndex = i + 1;
            } else if (bodyFontMatch) {
                foundCoverSettings.bodyFont = bodyFontMatch[1];
                bodyStartIndex = i + 1;
            } else if (bodyOrientationMatch) {
                foundCoverSettings.bodyOrientation = bodyOrientationMatch[1];
                bodyStartIndex = i + 1;
            } else if (printSizeMatch) {
                foundCoverSettings.printSize = printSizeMatch[1];
                bodyStartIndex = i + 1;
            } else if (line === '' && bodyStartIndex > 0) {
                bodyStartIndex = i + 1;
                break;
            } else if (line !== '') {
                if (bodyStartIndex === 0) {
                    // Not metadata yet
                } else {
                    break;
                }
            }
        }
    }

    let contentLines = (foundTitle || foundAuthor) ? lines.slice(bodyStartIndex) : lines;

    // Skip Aozora header boilerplate (delimited by dashed lines at the start)
    if (isAozora) {
        let headerEndIndex = -1;
        let dashedLineCount = 0;
        for (let i = 0; i < Math.min(contentLines.length, 20); i++) {
            if (contentLines[i].startsWith('-------')) {
                dashedLineCount++;
                if (dashedLineCount === 2) {
                    headerEndIndex = i;
                    break;
                }
            } else if (dashedLineCount === 0 && contentLines[i].trim() !== '') {
                // If we encounter non-empty content before any dashed line, it might not be a standard boilerplate header
                break;
            }
        }
        if (headerEndIndex !== -1) {
            contentLines = contentLines.slice(headerEndIndex + 1);
        }
    }

    // Strip Aozora footer (starts with "底本：")
    let footerStartIndex = -1;
    for (let i = contentLines.length - 1; i >= 0; i--) {
        if (contentLines[i].trim().startsWith('底本：')) {
            footerStartIndex = i;
            break;
        }
    }
    if (footerStartIndex !== -1) {
        contentLines = contentLines.slice(0, footerStartIndex);
    }

    if (foundTitle) titleInput.value = foundTitle;
    if (foundAuthor) authorInput.value = foundAuthor;
    if (foundCoverSettings.pos) coverPosSelect.value = foundCoverSettings.pos;
    if (foundCoverSettings.align) coverAlignSelect.value = foundCoverSettings.align;
    if (foundCoverSettings.writingMode) coverWritingModeSelect.value = foundCoverSettings.writingMode;
    if (foundCoverSettings.titleSize) titleSizeSelect.value = foundCoverSettings.titleSize;
    if (foundCoverSettings.authorSize) authorSizeSelect.value = foundCoverSettings.authorSize;
    if (foundCoverSettings.authorPrefix !== undefined) authorPrefixInput.value = foundCoverSettings.authorPrefix;
    if (foundCoverSettings.bodyFont) bodyFontSelect.value = foundCoverSettings.bodyFont;
    if (foundCoverSettings.bodyOrientation) bodyOrientationSelect.value = foundCoverSettings.bodyOrientation;
    if (foundCoverSettings.printSize) printSizeSelect.value = foundCoverSettings.printSize;

    applyBodySettings();
    applyPrintSettings();

    // Trim empty lines from start/end
    let start = 0;
    while (start < contentLines.length && contentLines[start].trim() === '') start++;
    let end = contentLines.length;
    while (end > start && contentLines[end - 1].trim() === '') end--;

    editor.value = contentLines.slice(start, end).join('\n');

    saveState();
    updateTabTitle();
    queueRender();
});

async function printNovel() {
    saveState();
    if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
    }
    renderPreview();
    updateTabTitle();
    requestAnimationFrame(() => window.print());
}

editor.addEventListener('input', () => {
    saveState();
    queueRender();
});

titleInput.addEventListener('input', () => {
    saveState();
    updateTabTitle();
    queueRender();
});
authorInput.addEventListener('input', () => {
    saveState();
    updateTabTitle();
    queueRender();
});
loadTextButton.addEventListener('click', loadTextFile);
pageBreakButton.addEventListener('click', () => insertAtCursor('［改ページ］'));
downloadTextButton.addEventListener('click', downloadText);
printButton.addEventListener('click', printNovel);
window.addEventListener('beforeprint', renderPreview);
window.addEventListener('resize', applyPreviewScale);

toggleSettingsButton.addEventListener('click', () => {
    settingsPanel.classList.toggle('active');
});

[coverPosSelect, coverAlignSelect, coverWritingModeSelect, titleSizeSelect, authorSizeSelect, bodyFontSelect, bodyOrientationSelect, printSizeSelect].forEach(el => {
    el.addEventListener('change', () => {
        saveState();
        applyBodySettings();
        applyPrintSettings();
        queueRender();
    });
});

authorPrefixInput.addEventListener('input', () => {
    saveState();
    queueRender();
});

loadState();
if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(renderPreview);
} else {
    renderPreview();
}
