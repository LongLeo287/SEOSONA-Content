// SRT Studio — Knowledge Pack (đóng gói sẵn, self-contained)
// Nội dung: hook formulas, công thức copywriting, cấu trúc script, brand voice VN,
// platform specs, YouTube SEO — biên tập từ phương pháp content/SEO của SEOSONA.
// Sửa trực tiếp file này để thêm/bớt/điều chỉnh. Các block bật/tắt ở tab Phân tích.

const Knowledge = (() => {

  // -------------------------------------------------- blocks bật/tắt trong prompt
  const BLOCKS = {
    hooks: {
      name: 'Hook formulas (5 mẫu)',
      default: true,
      text:
`## HOOK FORMULAS — chọn 1 mẫu cho đoạn mở đầu (dựa trên phụ đề có sẵn, KHÔNG bịa chữ):
- Stat: "[X]% [đối tượng] nói [nhận định], nhưng chỉ [Y]% thực sự [hành động]"
- Claim: "Tôi [kết quả bất ngờ] với [ràng buộc lạ]. Đây là cách chính xác."
- Question: "Điều gì xảy ra nếu bạn [lợi ích] mà không cần [nỗi đau]?"
- Story: "[Mốc thời gian] trước [sự kiện tiêu cực]. Đây là điều tôi đã làm."
- Counter-intuitive: "Lời khuyên mọi người vẫn nói về [X] là hoàn toàn sai."
Chọn cue mở đầu khớp nhất với 1 trong 5 kiểu trên; ghi kiểu hook đã chọn vào cột ghi chú.`,
    },
    structure: {
      name: 'Cấu trúc script 5 phần',
      default: true,
      text:
`## CẤU TRÚC 5 PHẦN (sắp thứ tự các cue theo khung này):
1. HOOK (0-15s) — chặn lướt: stat/claim/câu hỏi gây sốc. TUYỆT ĐỐI không mở bằng chào hỏi.
2. INTRO (ngắn) — vì sao đáng xem, tín hiệu uy tín.
3. VALUE (60-80% thời lượng) — 3-7 ý (số lẻ tốt hơn), mỗi ý: Khái niệm → Ví dụ → Áp dụng.
4. RETENTION HOOK (giữa video) — mở một vòng lặp: "Trước khi tới ý quan trọng nhất...".
5. CTA (15-30s cuối) — MỘT hành động duy nhất: follow / comment / xem tiếp.`,
    },
    formulas: {
      name: 'Công thức copywriting (PAS/QUEST/SCAR/AIDA)',
      default: false,
      text:
`## CÔNG THỨC COPYWRITING — chọn 1 khung mạch cảm xúc phù hợp nội dung:
- PAS (Problem → Agitation → Solution): nêu vấn đề → khoét sâu nỗi đau → giải pháp. Hợp short-form.
- QUEST (Qualify → Understand → Educate → Stimulate → Transition): hợp hướng dẫn/tutorial.
- SCAR (Story → Conflict → Aha → Result): kể chuyện thật, xác thực nhất.
- AIDA (Attention → Interest → Desire → Action): hợp ra mắt sản phẩm / khán giả lạnh.
Bám khung đã chọn khi sắp thứ tự cue.`,
    },
    brandVoice: {
      name: 'Brand voice SEOSONA (tiếng Việt)',
      default: false,
      text:
`## BRAND VOICE SEOSONA (áp dụng cho cột "Practical Value / ghi chú", KHÔNG sửa phụ đề gốc):
NÊN: tiếng Việt đơn giản, trực diện; mọi nhận định gắn dữ liệu; hướng hành động ("Bước tiếp theo: ...");
     câu chủ động ("Chúng tôi tối ưu" thay vì "được tối ưu"); xưng "bạn" trong nội dung đào tạo/blog.
TRÁNH: ngôn ngữ thổi phồng ("số 1 Việt Nam", "cam kết 100%"); giọng AI sáo rỗng ("Điều quan trọng cần lưu ý là...");
       dùng tiếng Anh khi có từ Việt tương đương; slang trong nội dung nghiêm túc.`,
    },
    seoAware: {
      name: 'Ưu tiên từ khóa SEO',
      default: false,
      text:
`## SEO AWARENESS: ưu tiên giữ những cue chứa từ khóa/thuật ngữ chuyên môn có giá trị tìm kiếm
(SEO, backlink, search intent, automation...) vì đây là tín hiệu chủ đề cho nền tảng. Không thêm từ khóa mới.`,
    },
  };

  // -------------------------------------------------- platform presets
  const PLATFORMS = {
    none: { name: 'Không giới hạn nền tảng', min: 30, max: 90, aspect: '', hook: '' },
    shorts: {
      name: 'YouTube Shorts', min: 15, max: 60, aspect: '9:16 (1080×1920)',
      hook: 'Hook trong 3 giây đầu, nhịp nhanh, một ý chủ đạo.',
    },
    tiktok: {
      name: 'TikTok', min: 15, max: 60, aspect: '9:16 (1080×1920)',
      hook: 'Hook cực nhanh + yếu tố gây tò mò/tranh luận để tăng comment.',
    },
    reels: {
      name: 'Instagram Reels', min: 15, max: 90, aspect: '9:16 (1080×1920)',
      hook: 'Hook thị giác mạnh, thẩm mỹ; hợp lưu lại/chia sẻ.',
    },
    long: {
      name: 'YouTube (dài)', min: 480, max: 900, aspect: '16:9 (1920×1080)',
      hook: 'Hook + preview payoff, giữ chân bằng nhiều vòng lặp mở.',
    },
  };

  function platformInstruction(id) {
    const p = PLATFORMS[id];
    if (!p || id === 'none') return '';
    return `## NỀN TẢNG MỤC TIÊU: ${p.name}
- Thời lượng mục tiêu: ${p.min}-${p.max} giây (tổng duration các cue được chọn phải nằm quanh khoảng này).
- Tỉ lệ khung hình: ${p.aspect}.
- ${p.hook}`;
  }

  function buildKnowledgeSection(blockIds) {
    const parts = blockIds.map((id) => BLOCKS[id] && BLOCKS[id].text).filter(Boolean);
    if (!parts.length) return '';
    return `\n============ KIẾN THỨC ÁP DỤNG (SEOSONA) ============\n${parts.join('\n\n')}\n`;
  }

  // -------------------------------------------------- YouTube SEO (cho metadata prompt)
  const YOUTUBE_SEO = {
    titleFormula: '[Từ khóa chính] — [Lợi ích/Kết quả] ([Năm hoặc Con số])',
    titleRules: 'Từ khóa chính trong 60 ký tự đầu; tổng 60-70 ký tự; có số/ngoặc tăng CTR; không clickbait.',
    descTemplate:
`[2-3 câu đầu có từ khóa chính, tóm tắt video]

📌 TIMESTAMPS
00:00 — Mở đầu
[MM:SS] — [Tiêu đề chương]

🔗 TÀI NGUYÊN
- [link]

🔔 SUBSCRIBE để xem thêm mẹo mỗi tuần

#tukhoa1 #tukhoa2 #tukhoa3`,
  };

  return { BLOCKS, PLATFORMS, platformInstruction, buildKnowledgeSection, YOUTUBE_SEO };
})();
