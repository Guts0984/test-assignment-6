// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatControl, formatMessage, formatPing, formatRetry } from './sse';

/** A parser written from the SSE spec (WHATWG HTML §9.2), independent of our formatter. */
function parse(stream: string) {
  return stream
    .split('\n\n')
    .filter((block) => block.length > 0)
    .map((block) => {
      const frame: {
        id?: string;
        event?: string;
        data: string[];
        comment?: string;
        retry?: string;
      } = { data: [] };
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) frame.comment = line.slice(1).trim();
        else {
          const i = line.indexOf(':');
          const field = i === -1 ? line : line.slice(0, i);
          const value = i === -1 ? '' : line.slice(i + 1).replace(/^ /, '');
          if (field === 'id') frame.id = value;
          else if (field === 'event') frame.event = value;
          else if (field === 'data') frame.data.push(value);
          else if (field === 'retry') frame.retry = value;
        }
      }
      return frame;
    });
}

describe('SSE framing', () => {
  it('one message is one frame with id, event and a single JSON data line', () => {
    const [f, ...rest] = parse(
      formatMessage({ id: 'e:5', type: 'events-changed', data: { a: 1 }, origin: 'tab' }),
    );
    expect(rest).toEqual([]);
    expect(f?.id).toBe('e:5');
    expect(f?.event).toBe('events-changed');
    expect(f?.data).toHaveLength(1);
    expect(JSON.parse(f!.data[0]!)).toEqual({ data: { a: 1 }, origin: 'tab' });
  });

  it('text with newlines, CRLF, unicode line separators and blank lines cannot break out of the frame', () => {
    const nasty = 'line1\nline2\r\n\r\nid: evil\nevent: hijack   \u0000 😀';
    const frames = parse(
      formatMessage({ id: 'e:1', type: 't', data: { title: nasty }, origin: null }),
    );
    expect(frames).toHaveLength(1);
    expect(frames[0]?.event).toBe('t');
    expect(frames[0]?.id).toBe('e:1');
    expect(JSON.parse(frames[0]!.data[0]!).data.title).toBe(nasty);
  });

  it('several messages stay separate frames in order', () => {
    const text = [1, 2, 3]
      .map((n) => formatMessage({ id: `e:${n}`, type: 't', data: n, origin: null }))
      .join('');
    expect(parse(text).map((f) => f.id)).toEqual(['e:1', 'e:2', 'e:3']);
  });

  it('control frames carry the current id so the client can resume from it', () => {
    expect(parse(formatControl('hello', 'e:9'))[0]).toMatchObject({ id: 'e:9', event: 'hello' });
    expect(parse(formatControl('resync', 'e:9'))[0]).toMatchObject({ id: 'e:9', event: 'resync' });
  });

  it('ping is a comment (ignored by EventSource) and retry is a retry field', () => {
    expect(parse(formatPing())[0]).toMatchObject({ comment: 'ping', data: [] });
    expect(parse(formatRetry(2000))[0]?.retry).toBe('2000');
  });
});
