// Core Pack — những luật viết mà MỌI loại nội dung đều cần.
//
// Đây là phần chắt ra từ knowledge blocks của extension, KHÔNG phải bản sao. Nhồi cả
// knowledge.js vào prompt là cách nhanh nhất để có một prompt dài, mâu thuẫn nội bộ và
// không ai sửa nổi: luật viết shorts nằm cạnh luật viết bài chuẩn SEO, luật nào cũng "quan
// trọng", và model tự chọn cái nó thích.
//
// Ranh giới: luật ở đây phải đúng cho bài blog, cho mô tả sản phẩm và cho transcript như nhau.
// Cái gì chỉ đúng cho một loại thì thuộc về job pack của loại đó.

export const CORE_RULE_IDS = Object.freeze([
  'factCheck', 'claimStrength', 'editingRules', 'concision', 'deslop',
  'audienceResearch', 'contentStrategy', 'auditRubric',
]);

export const CORE_PACK = Object.freeze({
  id: 'core.writing',
  version: '1.0.0',
  rules: Object.freeze([
    {
      id: 'factCheck',
      source: 'knowledge-src/15-factCheck.md',
      text: 'Mỗi con số, tên riêng, ngày tháng và phát biểu kiểm chứng được phải truy về một mẩu bằng chứng cụ thể. '
        + 'Không có bằng chứng thì viết cho đúng mức: nói rõ đây là ước lượng, là ý kiến, hoặc bỏ hẳn. '
        + 'TUYỆT ĐỐI không tự đặt ra nguồn, số liệu, trích dẫn hay tên nghiên cứu để lấp chỗ trống.',
    },
    {
      id: 'claimStrength',
      source: 'knowledge-src/16-claimStrength.md',
      text: 'Độ chắc của câu văn phải khớp độ chắc của bằng chứng. Bằng chứng cho thấy tương quan thì viết "liên quan", '
        + 'không viết "gây ra"; một nghiên cứu nhỏ thì viết "có dấu hiệu", không viết "đã chứng minh". '
        + 'Không nâng cấp "có thể" thành "sẽ", "thường" thành "luôn", "giúp" thành "bảo đảm".',
    },
    {
      id: 'editingRules',
      source: 'knowledge-src/17-editingRules.md',
      text: 'Sửa văn là sửa cách nói, không phải sửa điều được nói. Giữ nguyên ý nghĩa, số liệu, và mức độ chắc chắn. '
        + 'Khi buộc phải chọn giữa câu văn mượt hơn và câu văn đúng hơn, chọn đúng.',
    },
    {
      id: 'concision',
      source: 'knowledge-src/18-concision.md',
      text: 'Cắt chữ thừa, không cắt thông tin. Bỏ mở đầu vòng vo, câu chuyển tiếp rỗng, và phần nhắc lại điều vừa nói. '
        + 'Một câu chỉ nên tồn tại nếu nó thêm được điều gì mà câu trước chưa nói.',
    },
    {
      id: 'deslop',
      source: 'knowledge-src/22-deslop.md',
      text: 'Tránh giọng văn máy: mở bài kiểu "Trong thời đại ngày nay", cụm rỗng như "điều quan trọng cần lưu ý là", '
        + 'kết bài tóm tắt lại toàn bài, danh sách ba ý cân đối một cách máy móc, và tính từ nhấn mạnh thay cho dữ kiện. '
        + 'Viết như người hiểu việc đang nói với người cần dùng.',
    },
    {
      id: 'audienceResearch',
      source: 'knowledge-src/23-audienceResearch.md',
      text: 'Viết cho một người đọc cụ thể: họ đã biết gì, họ đang vướng ở đâu, và họ sẽ phản đối điều gì. '
        + 'Giải thích thuật ngữ ở mức người đọc đó cần, không thấp hơn (trịch thượng) và không cao hơn (mất người đọc).',
    },
    {
      id: 'contentStrategy',
      source: 'knowledge-src/24-contentStrategy.md',
      text: 'Mỗi bài phải phục vụ đúng một mục tiêu và đúng một ý định tìm kiếm. Nội dung không phục vụ mục tiêu đó là '
        + 'phần nên cắt, dù nó hay. Nói rõ người đọc làm được gì sau khi đọc xong.',
    },
    {
      id: 'auditRubric',
      source: 'knowledge-src/25-auditRubric.md',
      text: 'Bản thảo được chấm theo các trục tách bạch: tính chính xác, mức bằng chứng chống lưng, cấu trúc, độ dễ đọc, '
        + 'độ cô đọng, giọng thương hiệu và mức phù hợp người đọc. Một trục yếu không được bù bằng một trục mạnh — '
        + 'bài viết mượt mà nhưng sai vẫn là bài sai.',
    },
  ]),
});
