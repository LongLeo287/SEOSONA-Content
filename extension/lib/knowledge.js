// SRT Studio — Knowledge Pack (đóng gói sẵn, self-contained)
// Nội dung: hook formulas, công thức copywriting, cấu trúc script, brand voice VN,
// platform specs, YouTube SEO — biên tập từ phương pháp content/SEO của SEOSONA.
// Sửa trực tiếp file này để thêm/bớt/điều chỉnh. Các block bật/tắt ở tab Phân tích.

const Knowledge = (() => {

  // -------------------------------------------------- blocks bật/tắt trong prompt
  // <<<SYNC:BLOCKS>>> tự sinh từ knowledge-src/*.md bằng `node scripts/sync-knowledge.mjs` — đừng sửa tay
  const BLOCKS = {
    hooks: {
      name: "Hook formulas (5 mẫu)",
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
      name: "Cấu trúc script 5 phần",
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
      name: "Công thức copywriting (PAS/QUEST/SCAR/AIDA)",
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
      name: "Brand voice SEOSONA (tiếng Việt)",
      default: false,
      text:
`## BRAND VOICE SEOSONA (áp dụng cho cột "Practical Value / ghi chú", KHÔNG sửa phụ đề gốc):
NÊN: tiếng Việt đơn giản, trực diện; mọi nhận định gắn dữ liệu; hướng hành động ("Bước tiếp theo: ...");
     câu chủ động ("Chúng tôi tối ưu" thay vì "được tối ưu"); xưng "bạn" trong nội dung đào tạo/blog.
TRÁNH: ngôn ngữ thổi phồng ("số 1 Việt Nam", "cam kết 100%"); giọng AI sáo rỗng ("Điều quan trọng cần lưu ý là...");
       dùng tiếng Anh khi có từ Việt tương đương; slang trong nội dung nghiêm túc.`,
    },
    seoAware: {
      name: "Ưu tiên từ khóa SEO",
      default: false,
      text:
`## SEO AWARENESS: ưu tiên giữ những cue chứa từ khóa/thuật ngữ chuyên môn có giá trị tìm kiếm
(SEO, backlink, search intent, automation...) vì đây là tín hiệu chủ đề cho nền tảng. Không thêm từ khóa mới.`,
    },
    marketingPsychology: {
      name: "Tâm lý thuyết phục & giữ chân",
      default: false,
      text:
`## TÂM LÝ THUYẾT PHỤC & GIỮ CHÂN
- ƯU TIÊN GIỮ cue tạo open-loop / Zeigarnik: câu hỏi tu từ, "điều bất ngờ là...", lời hứa tiết lộ sau ("cuối video sẽ rõ") — tạo tò mò kéo người xem.
- GIỮ cue Loss Aversion / Urgency: nói về cái mất đi, sai lầm phải tránh, "đừng bỏ lỡ", giới hạn thời gian (chỉ khi thật sự có).
- GIỮ cue Social Proof / Authority: số liệu cụ thể, số khách hàng, kết quả thật, case study, "theo dữ liệu...", trích dẫn chuyên gia — tăng độ tin.
- GIỮ Pattern-Interrupt: câu mở đầu gây sốc, đảo kỳ vọng, thừa nhận điểm yếu (Pratfall) — chặn lướt qua.
- GIỮ cue nêu Pain Point cụ thể rồi chuyển sang giải pháp (contrast before→after) và lợi ích tức thì ("bắt đầu ngay hôm nay").
- ƯU TIÊN câu CỤ THỂ hơn câu chung chung (số, thời gian, kết quả). HẠ ưu tiên: câu đệm, lặp, xã giao, lan man không đẩy câu chuyện.
- ĐÁNH DẤU cue mở (hook) và cue chốt (CTA/kết) là điểm neo — theo Peak-End, phần đỉnh và phần cuối quyết định trải nghiệm.`,
    },
    youtubeSeo: {
      name: "YouTube / on-page SEO & metadata",
      default: false,
      text:
`## YOUTUBE SEO & METADATA
- ƯU TIÊN GIỮ cue chứa TỪ KHÓA tìm kiếm & thuật ngữ chuyên môn (tên công cụ, khái niệm, con số, tên riêng) — đây là tín hiệu search giá trị, đừng cắt.
- CHỌN 1 câu XỨNG LÀM TIÊU ĐỀ: chứa từ khóa chính trong ~50 ký tự đầu, tiêu đề ≤60 ký tự, cụ thể + gây tò mò/lợi ích rõ. Đề xuất 2-3 phương án tiêu đề từ chính lời thoại.
- GẮN CỜ điểm CHUYỂN CHỦ ĐỀ (topic shift) làm mốc chapter: câu mở đoạn mới, "tiếp theo", "phần 2", đổi bước — mỗi mốc là 1 chapter có timestamp.
- Từ khóa nên xuất hiện sớm: ưu tiên cue chứa keyword trong ~100 chữ đầu của script.
- GỢI Ý 5-15 tag/keyword từ các cue: cụm danh từ lặp lại, biến thể từ khóa, thực thể được nhắc nhiều lần.
- GIỮ cue có câu trả lời ngắn gọn cho câu hỏi (FAQ-worthy) — tốt cho featured snippet & mô tả.
- Meta/description: chọn cue tóm tắt được giá trị chính + có CTA, 150-160 ký tự.`,
    },
    contentFrameworks: {
      name: "Khung nội dung & tái sử dụng",
      default: false,
      text:
`## KHUNG NỘI DUNG & TÁI SỬ DỤNG
- SẮP XẾP cue đã chọn theo cung truyện: HOOK (0-5s) → GIỚI THIỆU/bối cảnh → NỘI DUNG CHÍNH chia 2-4 điểm mạch lạc → RECAP → CTA. Mỗi đoạn chỉ một ý.
- Với SHORT-FORM: giữ 1 hook cực mạnh + 1 điểm giá trị + 1 CTA; cắt bối cảnh dài, ưu tiên cue độc lập, đứng một mình vẫn hiểu.
- Với LONG-FORM: giữ đủ mạch How-to/các bước, ví dụ, số liệu, câu chuyển đoạn để mượt; mỗi timestamp thành một section header.
- ĐÁNH DẤU đoạn TÁI SỬ DỤNG ĐA NỀN TẢNG: câu trích ngắn đắt giá → Twitter/X; điểm chính → carousel/LinkedIn; tip nhanh → Reels/TikTok; số liệu → infographic.
- ƯU TIÊN giữ: cue có actionable takeaway, ví dụ thực tế, dữ liệu hỗ trợ, câu chốt mỗi ý. HẠ ưu tiên: câu trùng ý, lan man, không đẩy mạch.
- ĐẢM BẢO thứ tự cue giữ được logic nhân-quả; nếu cắt cue bản lề làm đứt mạch, giữ lại hoặc chọn cue nối thay thế.`,
    },
    cboBrand: {
      name: "C.B.O & brand voice SEOSONA",
      default: false,
      text:
`## C.B.O & BRAND VOICE SEOSONA (dùng cho cột Ghi chú/Giá trị, KHÔNG sửa phụ đề gốc)
- CHỌN cue theo hành trình khách hàng: Awareness → Consideration → Decision → Purchase → Use → Advocacy; đảm bảo mỗi giai đoạn có ít nhất 1 cue đại diện.
- CONVERSION: ưu tiên giữ cue điều hướng hành động rõ (CTA), câu chốt lợi ích, lời mời bước tiếp theo — đúng ý định người xem.
- BRANDING: giữ cue thể hiện chuyên môn thật, số liệu, kinh nghiệm (E-E-A-T), tăng nhận diện; loại cue rỗng, không thêm giá trị.
- OPTIMIZATION: ưu tiên cue hữu ích cho cả người xem lẫn máy đọc (rõ nghĩa, chứa keyword tự nhiên).
- GHI CHÚ theo giọng SEOSONA — DO: tiếng Việt đơn giản, trực tiếp, chủ động; mỗi nhận định gắn dữ liệu/lý do; hành động cụ thể. DON'T: nói quá ("số 1 VN", "cam kết 100%"), giọng AI ("Điều quan trọng cần lưu ý là..."), lạm dụng từ tiếng Anh khi có từ Việt.
- LƯU Ý: chỉ áp brand voice cho phần ghi chú/đánh giá; TUYỆT ĐỐI giữ nguyên văn phụ đề gốc.`,
    },
  };
  // <<<END:BLOCKS>>>

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
