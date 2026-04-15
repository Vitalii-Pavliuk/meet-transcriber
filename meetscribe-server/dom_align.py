def align_with_dom(segments, dom_timeline, recording_start_ms):
    if not dom_timeline:
        return None
    dom_segs = []
    for item in dom_timeline:
        start_sec = (item['start'] - recording_start_ms) / 1000.0
        end_sec   = (item['end']   - recording_start_ms) / 1000.0
        if end_sec > 0:
            dom_segs.append({
                'name':  item['name'],
                'start': max(0.0, start_sec),
                'end':   end_sec,
            })

    if not dom_segs:
        return None

    def get_speaker(seg_start, seg_end):
        best_name    = None
        best_overlap = 0.0
        check_end = seg_start + min(seg_end - seg_start, 3.0)
        for dom in dom_segs:
            overlap = min(check_end, dom['end']) - max(seg_start, dom['start'])
            if overlap > best_overlap:
                best_overlap = overlap
                best_name    = dom['name']
        return best_name

    lines = []
    current_speaker = None
    current_start   = None
    current_texts   = []

    def flush():
        if not current_texts or current_start is None:
            return
        h = int(current_start // 3600)
        m = int((current_start % 3600) // 60)
        s = int(current_start % 60)
        ts    = f"[{h:02d}:{m:02d}:{s:02d}]"
        label = f"{current_speaker}: " if current_speaker else ""
        lines.append(f"{ts} {label}{' '.join(current_texts).strip()}")

    for seg in segments:
        text = seg.text.strip()
        if not text:
            continue
        speaker = get_speaker(seg.start, seg.end)
        if speaker != current_speaker:
            flush()
            current_speaker = speaker
            current_start   = seg.start
            current_texts   = [text]
        else:
            if current_start is None:
                current_start = seg.start
            current_texts.append(text)

    flush()
    return '\n'.join(lines)
