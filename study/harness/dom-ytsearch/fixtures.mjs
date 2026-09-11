// Deterministic search-response fixtures for the ytsearch results render.
// Shapes satisfy src/client-runtime.ts decoders exactly.

const QUERY = "moment";

export function buildMountResponse() {
  const videos = Array.from({ length: 30 }, (_, i) => {
    const kind = i % 10 === 7 ? "short" : i % 15 === 14 ? "unknown" : "video";
    const hits = Array.from({ length: 3 }, (_, j) => buildHit(i, j));
    return {
      video_id: `vid-${i}`,
      title: `Video result ${i}: deterministic corpus row`,
      title_highlight:
        i % 2 === 0
          ? `<mark>Video</mark> result ${i}: deterministic corpus row`
          : undefined,
      youtuber_handle: `@creator${i % 7}`,
      youtuber_name: `Creator ${i % 7}`,
      thumbnail: `https://i.ytimg.com/vi/vid-${i}/hqdefault.jpg`,
      published_at: `2025-0${(i % 9) + 1}-1${i % 9}T12:00:00Z`,
      view_count: 1000 * (i + 1),
      like_count: 10 * (i + 1),
      comment_count: i % 5 === 0 ? undefined : i + 1,
      content_kind: kind,
      match_count: 3,
      youtube_url: `https://www.youtube.com/watch?v=vid-${i}&t=12s`,
      embed_url: `https://www.youtube.com/embed/vid-${i}?start=12`,
      best_timestamp: "0:12",
      hits,
    };
  });
  return {
    query: QUERY,
    total_moments: 90,
    total_videos: 30,
    totals_approximate: false,
    total_found: 30,
    out_of: 30,
    time_to_first_result_ms: 8,
    page: 1,
    per_page: 30,
    sort: "relevance",
    mode: "lexical",
    has_next_page: false,
    hits: videos.flatMap((video) => video.hits),
    videos,
  };
}

export const EXPAND_VIDEO_ID = "vid-0";

export function buildInitialSingleVideoResponse() {
  const video = {
    video_id: EXPAND_VIDEO_ID,
    title: "Expandable result: deterministic corpus row",
    title_highlight: "<mark>Expandable</mark> result: deterministic corpus row",
    youtuber_handle: "@creator0",
    youtuber_name: "Creator 0",
    thumbnail: `https://i.ytimg.com/vi/${EXPAND_VIDEO_ID}/hqdefault.jpg`,
    published_at: "2025-03-11T12:00:00Z",
    view_count: 1000,
    like_count: 10,
    comment_count: 5,
    content_kind: "video",
    match_count: 100,
    youtube_url: `https://www.youtube.com/watch?v=${EXPAND_VIDEO_ID}&t=12s`,
    embed_url: `https://www.youtube.com/embed/${EXPAND_VIDEO_ID}?start=12`,
    best_timestamp: "0:12",
    hits: Array.from({ length: 3 }, (_, j) => buildHit(0, j)),
  };
  return {
    query: QUERY,
    total_moments: 100,
    total_videos: 1,
    totals_approximate: false,
    total_found: 1,
    out_of: 1,
    time_to_first_result_ms: 8,
    page: 1,
    per_page: 30,
    sort: "relevance",
    mode: "lexical",
    has_next_page: false,
    hits: video.hits,
    videos: [video],
  };
}

export function buildExpandedResponse() {
  const video = {
    video_id: EXPAND_VIDEO_ID,
    title: "Expandable result: deterministic corpus row",
    title_highlight: "<mark>Expandable</mark> result: deterministic corpus row",
    youtuber_handle: "@creator0",
    youtuber_name: "Creator 0",
    thumbnail: `https://i.ytimg.com/vi/${EXPAND_VIDEO_ID}/hqdefault.jpg`,
    published_at: "2025-03-11T12:00:00Z",
    view_count: 1000,
    like_count: 10,
    comment_count: 5,
    content_kind: "video",
    match_count: 100,
    youtube_url: `https://www.youtube.com/watch?v=${EXPAND_VIDEO_ID}&t=12s`,
    embed_url: `https://www.youtube.com/embed/${EXPAND_VIDEO_ID}?start=12`,
    best_timestamp: "0:12",
    hits: Array.from({ length: 100 }, (_, j) => buildHit(0, j)),
  };
  return {
    query: QUERY,
    total_moments: 100,
    total_videos: 1,
    totals_approximate: false,
    total_found: 1,
    out_of: 1,
    time_to_first_result_ms: 8,
    page: 1,
    per_page: 100,
    sort: "relevance",
    mode: "lexical",
    has_next_page: false,
    hits: video.hits,
    videos: [video],
  };
}

function buildHit(videoIndex, j) {
  const id = `hit-${videoIndex}-${j}`;
  const transcript = j !== 1;
  const seconds = 12 + j * 60 + videoIndex;
  const timestamp = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return {
    id,
    video_id: `vid-${videoIndex}`,
    title: `Video result ${videoIndex}: deterministic corpus row`,
    text: `The transcript moment ${videoIndex}-${j} explains how the pieces fit together &amp; why.`,
    prev_text: transcript ? `Before the moment ${videoIndex}-${j}, context lines.` : null,
    next_text: transcript ? `After the moment ${videoIndex}-${j}, more context.` : null,
    text_highlight: transcript
      ? `The transcript <mark>moment</mark> ${videoIndex}-${j} explains how the pieces fit together &amp; why.`
      : undefined,
    title_highlight:
      j === 1
        ? `<mark>Video</mark> result ${videoIndex}: deterministic corpus row`
        : undefined,
    match_kind: transcript ? "transcript" : "title",
    youtuber_handle: `@creator${videoIndex % 7}`,
    youtuber_name: `Creator ${videoIndex % 7}`,
    thumbnail: `https://i.ytimg.com/vi/vid-${videoIndex}/hqdefault.jpg`,
    published_at: "2025-03-11T12:00:00Z",
    view_count: 1000 * (videoIndex + 1),
    like_count: 10 * (videoIndex + 1),
    comment_count: 5,
    content_kind: "video",
    t_start_ms: seconds * 1000,
    timestamp,
    youtube_url: `https://www.youtube.com/watch?v=vid-${videoIndex}&t=${seconds}s`,
    embed_url: `https://www.youtube.com/embed/vid-${videoIndex}?start=${seconds}`,
  };
}

export function placeholderSvg(videoId) {
  const digits = videoId.replace(/\D/g, "") || "0";
  const hue = (Number(digits) * 47) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="hsl(${hue} 55% 35%)"/><rect x="8" y="8" width="304" height="164" fill="none" stroke="hsl(${hue} 60% 70%)" stroke-width="2"/><text x="160" y="96" font-family="sans-serif" font-size="20" fill="white" text-anchor="middle">thumb ${digits}</text></svg>`;
}
