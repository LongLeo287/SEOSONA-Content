// Client gọi Runtime API từ Studio.
//
// Studio chạy CÙNG ORIGIN với Runtime, nên nó xác thực bằng cookie phiên HttpOnly do Runtime
// phát khi phục vụ trang. Không có token nào nằm trong file JS này — token nhúng vào file tĩnh
// là bí mật nằm trên đĩa, đọc được bởi bất cứ thứ gì đọc được thư mục đó, và nằm đó mãi mãi.
//
// Mọi thay đổi đi qua API và LẤY LẠI bản ghi từ phản hồi. Studio không tự dựng bản ghi trong
// bộ nhớ rồi coi đó là thật: làm vậy sẽ có hai phiên bản sự thật, và bản trên màn hình sẽ
// lệch dần khỏi bản trên đĩa mà không ai biết lúc nào.

const JSON_HEADERS = { 'content-type': 'application/json' };

export function createStudioApiClient({ fetchImpl = globalThis.fetch, baseUrl = '' } = {}) {
  async function request(path, { method = 'GET', body } = {}) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      // same-origin: cookie phiên đi kèm, không cần và không được đính token.
      credentials: 'same-origin',
      headers: body === undefined ? {} : JSON_HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (response.status === 204) return null;
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      // Vỏ lỗi của Runtime ổn định; giữ nguyên mã để giao diện hiển thị đúng nguyên nhân
      // thay vì một câu "có lỗi xảy ra" chung chung.
      const error = new Error(payload?.error?.message || `Runtime trả về ${response.status}.`);
      error.code = payload?.error?.code || 'RUNTIME_ERROR';
      error.httpStatus = response.status;
      error.retryable = payload?.error?.retryable === true;
      throw error;
    }
    return payload;
  }

  return {
    request,
    health: () => request('/v1/health'),

    listProjects: () => request('/v1/projects'),
    getProject: (projectId) => request(`/v1/projects/${encodeURIComponent(projectId)}`),
    createProject: (body) => request('/v1/projects', { method: 'POST', body }),
    createBrand: (body) => request('/v1/brands', { method: 'POST', body }),

    addSource: (projectId, body) => request(`/v1/projects/${encodeURIComponent(projectId)}/sources`, { method: 'POST', body }),
    addTranscript: (projectId, body) => request(`/v1/projects/${encodeURIComponent(projectId)}/transcripts`, { method: 'POST', body }),

    listJobPacks: () => request('/v1/job-packs'),
    buildBrief: (projectId, body) => request(`/v1/projects/${encodeURIComponent(projectId)}/briefs`, { method: 'POST', body }),
    runWrite: (projectId, body) => request(`/v1/projects/${encodeURIComponent(projectId)}/write`, { method: 'POST', body }),
    runEdit: (contentId, body) => request(`/v1/content/${encodeURIComponent(contentId)}/edit`, { method: 'POST', body }),
    runAudit: (contentId, body) => request(`/v1/content/${encodeURIComponent(contentId)}/audit`, { method: 'POST', body }),
    runRepurpose: (contentId, body) => request(`/v1/content/${encodeURIComponent(contentId)}/repurpose`, { method: 'POST', body }),
    getContentHistory: (contentId) => request(`/v1/content/${encodeURIComponent(contentId)}`),

    listProviders: () => request('/v1/providers'),
    updateProvider: (providerId, body) => request(`/v1/providers/${encodeURIComponent(providerId)}`, { method: 'PATCH', body }),
    previewRoute: (body) => request('/v1/providers/route-preview', { method: 'POST', body }),

    getJob: (jobId) => request(`/v1/jobs/${encodeURIComponent(jobId)}`),
    resumeJob: (jobId) => request(`/v1/jobs/${encodeURIComponent(jobId)}/resume`, { method: 'POST' }),
    cancelJob: (jobId, reason) => request(`/v1/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST', body: { reason } }),

    startPairing: () => request('/v1/pairing/start', { method: 'POST' }),
  };
}
