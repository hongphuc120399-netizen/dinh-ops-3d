import React, { useMemo, useState } from 'react';
import {
  CHINH_NAM_PILLARS,
  type CultureKnowledgeChunk,
  type CulturePillarId,
  type CultureSectionType
} from '../data/chinhNamCultureData';
import {
  cultureHybridIndex,
  loadCustomCultureChunks,
  saveCustomCultureChunks,
  stripVietnameseAccents
} from '../utils/cultureSearchEngine';

const HL_STOPWORDS = new Set([
  'la', 'va', 'co', 'de', 'thi', 'ma', 'cho', 'cua', 'khi', 'hay', 'cac', 'mot', 'nhung', 'trong', 'voi', 'duoc', 'khong', 'phai', 'can'
]);

/**
 * Highlights matched whole Vietnamese words accurately:
 * - Respects Vietnamese diacritics when the user typed accents ("đổ" won't falsely highlight "Độ" or "Động").
 * - Matches accent-insensitively when the user typed without accents ("do thua" highlights "đổ", "thừa").
 * - Highlights semantic expansion hits on whole-word boundaries only.
 */
function renderHighlightedVietnamese(
  text: string,
  rawQuery: string,
  matchedAsciiTokens: string[]
): React.ReactNode {
  if (!text || (!rawQuery.trim() && !matchedAsciiTokens.length)) return text;

  const qWords = rawQuery
    .toLowerCase()
    .normalize('NFC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2)
    .map((w) => {
      const ascii = stripVietnameseAccents(w);
      return { raw: w, ascii, hasAccent: w !== ascii };
    });

  const qAsciiSet = new Set(qWords.map((q) => q.ascii));
  const semanticExtras = matchedAsciiTokens.filter(
    (tk) => tk.length >= 3 && !qAsciiSet.has(tk) && !HL_STOPWORDS.has(tk)
  );

  if (!qWords.length && !semanticExtras.length) return text;

  const parts = text.split(/([\p{L}\p{N}]+)/gu);
  let hasAnyHit = false;
  const nodes = parts.map((part, idx) => {
    if (idx % 2 === 0 || !part) return part;
    const wLower = part.toLowerCase().normalize('NFC');
    const wAscii = stripVietnameseAccents(wLower);

    let hit = false;
    for (const qw of qWords) {
      if (HL_STOPWORDS.has(qw.ascii) && qWords.length > 2) continue;
      if (qw.hasAccent) {
        if (wLower === qw.raw || (qw.raw.length >= 4 && wLower.startsWith(qw.raw))) {
          hit = true;
          break;
        }
      } else {
        if (wAscii === qw.ascii || (qw.ascii.length >= 4 && wAscii.startsWith(qw.ascii))) {
          hit = true;
          break;
        }
      }
    }

    if (!hit && semanticExtras.length > 0) {
      for (const st of semanticExtras) {
        if (wAscii === st) {
          hit = true;
          break;
        }
      }
    }

    if (!hit) return part;
    hasAnyHit = true;
    return (
      <mark key={idx} className="culture-hl-mark">
        {part}
      </mark>
    );
  });

  return hasAnyHit ? nodes : text;
}

const SAMPLE_QUERIES = [
  { label: '80/20', q: '80/20' },
  { label: 'Right-first-time', q: 'Right-first-time' },
  { label: 'Cấp độ 3', q: 'cấp độ 3' },
  { label: 'Sếp / Lãnh đạo', q: 'sếp làm gương' },
  { label: 'Hay đổ thừa', q: 'nhân viên hay đổ thừa' },
  { label: 'Giấu nghề', q: 'giấu nghề giữ ghế' },
  { label: 'Chia phe', q: 'chia phe nói xấu' }
];

export const CultureHandbookPanel: React.FC = () => {
  const [query, setQuery] = useState<string>('');
  const [pillarFilter, setPillarFilter] = useState<CulturePillarId | 'all'>('all');
  const [sectionFilter, setSectionFilter] = useState<CultureSectionType | 'all' | 'lack_signs'>('all');
  const [viewMode, setViewMode] = useState<'search' | 'matrix' | 'add_custom'>('search');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [customChunks, setCustomChunks] = useState<CultureKnowledgeChunk[]>(() =>
    loadCustomCultureChunks()
  );
  const [newTitle, setNewTitle] = useState<string>('');
  const [newBody, setNewBody] = useState<string>('');
  const [newTags, setNewTags] = useState<string>('');

  const { results, elapsedMs } = useMemo(() => {
    const t0 = performance.now();
    const hits = cultureHybridIndex.search(query, pillarFilter, sectionFilter, customChunks);
    const dt = Math.max(0.05, performance.now() - t0);
    return { results: hits, elapsedMs: dt };
  }, [query, pillarFilter, sectionFilter, customChunks]);

  const handleCopyChunk = async (c: CultureKnowledgeChunk) => {
    const lines = [
      `[${c.pillarName} • Trang ${c.page}] ${c.title}`,
      ...(c.highlightFormulaOrQuote ? [`★ ${c.highlightFormulaOrQuote}`] : []),
      ...c.bullets.map((b) => `• ${b}`),
      ...(c.warningLack ? [`⚠️ ${c.warningLack}`] : [])
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopiedId(c.id);
      window.setTimeout(() => setCopiedId((prev) => (prev === c.id ? null : prev)), 1500);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleAddCustomChunk = () => {
    const cleanTitle = newTitle.trim();
    const lines = newBody
      .split(/\n+/)
      .map((l) => l.replace(/^[•\-*]\s*/, '').trim())
      .filter(Boolean);
    if (!cleanTitle && lines.length === 0) return;

    const added: CultureKnowledgeChunk = {
      id: `custom-cn-${Date.now()}`,
      pillarId: 'custom',
      pillarName: 'Tài Liệu Bổ Sung',
      pillarIcon: '📌',
      pillarColor: '#eab308',
      sectionType: 'custom_note',
      sectionBadge: 'Nạp thêm Offline',
      page: 23,
      title: cleanTitle || lines[0].slice(0, 60),
      bullets: lines.length > 0 ? lines : [cleanTitle],
      semanticKeywords: newTags
        .split(/[,;]+/)
        .map((s) => s.trim())
        .filter(Boolean),
      isCustom: true
    };
    const next = [added, ...customChunks];
    setCustomChunks(next);
    saveCustomCultureChunks(next);
    setNewTitle('');
    setNewBody('');
    setNewTags('');
    setViewMode('search');
  };

  const handleDeleteCustom = (id: string) => {
    const next = customChunks.filter((c) => c.id !== id);
    setCustomChunks(next);
    saveCustomCultureChunks(next);
  };

  return (
    <div className="toolkit-body culture-panel-root">
      {/* TOP MODE SWITCHER */}
      <div className="culture-top-bar">
        <div className="culture-title-meta">
          <strong>📘 Sổ Tay Văn Hóa Chính Nam (22 trang • Offline 100%)</strong>
          <small>
            Hybrid Search: <b>BM25 Từ khóa (có/không dấu)</b> + <b>Embedded Vector Ngữ nghĩa</b> •{' '}
            <span className="culture-ms-badge">{elapsedMs.toFixed(2)} ms</span>
          </small>
        </div>
        <div className="culture-mode-btns">
          <button
            type="button"
            className={viewMode === 'search' ? 'active' : ''}
            onClick={() => setViewMode('search')}
          >
            🔍 Tìm Nhanh
          </button>
          <button
            type="button"
            className={viewMode === 'matrix' ? 'active' : ''}
            onClick={() => setViewMode('matrix')}
          >
            ⚡ Bảng Tóm Tắt 5 Văn Hóa
          </button>
          <button
            type="button"
            className={viewMode === 'add_custom' ? 'active' : ''}
            onClick={() => setViewMode('add_custom')}
          >
            ➕ Nạp Thêm ({customChunks.length})
          </button>
        </div>
      </div>

      {viewMode === 'add_custom' && (
        <div className="culture-custom-card">
          <strong>📌 Nạp thêm Quy định / Mật lệnh BTC vào Bộ nhớ Vector Offline</strong>
          <small>
            Văn bản nạp thêm sẽ tự động tạo Vector ngữ nghĩa + chỉ mục không dấu ngay trên điện thoại (không cần mạng).
          </small>
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Tiêu đề mục (VD: Nội quy Trạm 3 / Khẩu hiệu năm 2026)..."
          />
          <textarea
            rows={4}
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            placeholder="Dán nội dung từng dòng vào đây..."
          />
          <input
            type="text"
            value={newTags}
            onChange={(e) => setNewTags(e.target.value)}
            placeholder="Từ đồng nghĩa gợi nhớ (tùy chọn, cách nhau dấu phẩy)..."
          />
          <div className="culture-custom-actions">
            <button type="button" className="primary-action-btn" onClick={handleAddCustomChunk}>
              ✅ Tạo Vector &amp; Lưu Offline
            </button>
            <button
              type="button"
              className="secondary-action-btn"
              onClick={() => setViewMode('search')}
            >
              Hủy
            </button>
          </div>
        </div>
      )}

      {viewMode === 'matrix' && (
        <div className="culture-matrix-wrap">
          <div className="culture-formula-summary">
            <strong>📐 Đối Chiếu Nhanh 5 Công Thức &amp; Số Tầng (Hay Hỏi Ở Trạm!)</strong>
            {CHINH_NAM_PILLARS.map((p) => (
              <div key={p.id} className="cf-row" style={{ borderLeftColor: p.color }}>
                <div className="cf-head">
                  <span style={{ color: p.color, fontWeight: 700 }}>
                    {p.icon} {p.name} ({p.tierCount} tầng • Trang {p.pageStart}–{p.pageEnd})
                  </span>
                </div>
                <div className="cf-eq">{p.formula}</div>
                <div className="cf-quote">{p.quote}</div>
              </div>
            ))}
          </div>

          <div className="culture-levels-Compare">
            <strong>📊 Bảng Phân Loại Cấp Độ 0 → 4 Của 5 Văn Hóa</strong>
            <div className="culture-table-scroll">
              <table className="culture-cmp-table">
                <thead>
                  <tr>
                    <th>Cấp</th>
                    {CHINH_NAM_PILLARS.map((p) => (
                      <th key={p.id} style={{ color: p.color }}>
                        {p.icon} {p.shortName}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[0, 1, 2, 3, 4].map((lv) => (
                    <tr key={lv}>
                      <td>
                        <strong>Cấp {lv}</strong>
                      </td>
                      {CHINH_NAM_PILLARS.map((p) => {
                        const row = p.levels[lv];
                        return (
                          <td key={p.id}>
                            <strong>{row.label.replace(/^\d+\s*–\s*/, '')}</strong>
                            <small>{row.description}</small>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {viewMode === 'search' && (
        <>
          {/* INSTANT SEARCH BAR */}
          <div className="culture-search-box">
            <div className="culture-input-row">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Gõ từ khóa có/không dấu hoặc ý nghĩa (VD: 80/20, cap do 3, sep lam guong, do thua, giau nghe)..."
                autoComplete="off"
              />
              {query && (
                <button
                  type="button"
                  className="culture-clear-btn"
                  onClick={() => setQuery('')}
                >
                  ✕ Xóa
                </button>
              )}
            </div>

            <div className="culture-sample-row">
              <small>Thử nhanh:</small>
              {SAMPLE_QUERIES.map((sq) => (
                <button
                  key={sq.label}
                  type="button"
                  className={query === sq.q ? 'active' : ''}
                  onClick={() => setQuery(query === sq.q ? '' : sq.q)}
                >
                  {sq.label}
                </button>
              ))}
            </div>

            {/* 5 PILLAR CHIPS */}
            <div className="culture-filter-row">
              <button
                type="button"
                className={pillarFilter === 'all' ? 'active' : ''}
                onClick={() => setPillarFilter('all')}
              >
                Tất cả (5 Văn hóa)
              </button>
              {CHINH_NAM_PILLARS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={pillarFilter === p.id ? 'active' : ''}
                  style={
                    pillarFilter === p.id
                      ? { borderColor: p.color, color: p.color }
                      : undefined
                  }
                  onClick={() => setPillarFilter(pillarFilter === p.id ? 'all' : p.id)}
                >
                  {p.icon} {p.shortName} ({p.tierCount}T)
                </button>
              ))}
              {customChunks.length > 0 && (
                <button
                  type="button"
                  className={pillarFilter === 'custom' ? 'active' : ''}
                  onClick={() => setPillarFilter(pillarFilter === 'custom' ? 'all' : 'custom')}
                >
                  📌 Bổ sung ({customChunks.length})
                </button>
              )}
            </div>

            {/* SECTION TYPE CHIPS */}
            <div className="culture-filter-row is-sub">
              {[
                { id: 'all', label: 'Mọi mục' },
                { id: 'essence_formula', label: '📐 Công thức & Bản chất' },
                { id: 'tier', label: '🪜 Các tầng tiêu chí (38 tầng)' },
                { id: 'lack_signs', label: '⚠️ Dấu hiệu thiếu' },
                { id: 'levels', label: '📊 Checklist & Cấp 0→4' },
                { id: 'golden_rules', label: '🏆 Nguyên tắc vàng & Câu nói' }
              ].map((sf) => (
                <button
                  key={sf.id}
                  type="button"
                  className={sectionFilter === sf.id ? 'active' : ''}
                  onClick={() =>
                    setSectionFilter(
                      sectionFilter === sf.id ? 'all' : (sf.id as typeof sectionFilter)
                    )
                  }
                >
                  {sf.label}
                </button>
              ))}
            </div>
          </div>

          {/* SEARCH RESULTS STREAM */}
          <div className="culture-results-meta">
            <span>
              Tìm thấy <strong>{results.length}</strong> mục phù hợp
              {query.trim() ? ` cho “${query.trim()}”` : ' (toàn bộ 22 trang Sổ tay)'}
            </span>
          </div>

          <div className="culture-results-list">
            {results.length === 0 ? (
              <div className="culture-empty">
                Không có mục nào khớp bộ lọc hiện tại. Bấm “Mọi mục” hoặc thử từ khóa ngắn hơn!
              </div>
            ) : (
              results.map(({ chunk, scorePct, matchType, matchedAsciiTokens }) => (
                <article
                  key={chunk.id}
                  className="culture-card"
                  style={{ borderLeftColor: chunk.pillarColor }}
                >
                  <div className="cc-header">
                    <div className="cc-badges">
                      <span className="cc-pillar-tag" style={{ color: chunk.pillarColor }}>
                        {chunk.pillarIcon} {chunk.pillarName}
                      </span>
                      <span className="cc-page-tag">Trang {chunk.page}</span>
                      <span className="cc-sec-tag">{chunk.sectionBadge}</span>
                      {query.trim() && (
                        <span
                          className={`cc-match-tag ${
                            matchType === 'semantic_vector' ? 'is-semantic' : 'is-kw'
                          }`}
                        >
                          {matchType === 'semantic_vector'
                            ? `🧠 Ngữ nghĩa Vector ${scorePct}%`
                            : `🎯 Khớp ${scorePct}%`}
                        </span>
                      )}
                    </div>
                    <div className="cc-actions">
                      <button
                        type="button"
                        className="cc-copy-btn"
                        onClick={() => handleCopyChunk(chunk)}
                      >
                        {copiedId === chunk.id ? '✅ Đã chép' : '📋 Chép'}
                      </button>
                      {chunk.isCustom && (
                        <button
                          type="button"
                          className="cc-del-btn"
                          onClick={() => handleDeleteCustom(chunk.id)}
                          title="Xóa ghi chú bổ sung"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>

                  <h4 className="cc-title">
                    {renderHighlightedVietnamese(chunk.title, query, matchedAsciiTokens)}
                  </h4>

                  {chunk.highlightFormulaOrQuote && (
                    <div className="cc-formula-box">
                      {renderHighlightedVietnamese(
                        chunk.highlightFormulaOrQuote,
                        query,
                        matchedAsciiTokens
                      )}
                    </div>
                  )}

                  <ul className="cc-bullet-list">
                    {chunk.bullets.map((b, idx) => (
                      <li key={idx}>
                        {renderHighlightedVietnamese(b, query, matchedAsciiTokens)}
                      </li>
                    ))}
                  </ul>

                  {chunk.warningLack && (
                    <div className="cc-lack-box">
                      ⚠️ {renderHighlightedVietnamese(chunk.warningLack, query, matchedAsciiTokens)}
                    </div>
                  )}
                </article>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
};
