// SecretMasker 纯函数用例（T4-16 / TDD-C-M1 §3 SecretMasker 行＋§6.1f 掩码断言的函数面）。
import { describe, expect, it } from 'vitest';
import { SECRET_MASK, mask } from './secret-masker';

describe('SecretMasker 掩码纯函数（sk-***，02 §12.3）', () => {
  it('明文 apiKey token → sk-***（§6.1f 冻结样本 sk-test-123xyz）', () => {
    expect(mask('key=sk-test-123xyz')).toBe(`key=${SECRET_MASK}`);
    expect(mask('prefix sk-abcDEF123456 tail')).toBe(`prefix ${SECRET_MASK} tail`);
  });

  it('多个 token 全掩码；JSON 行内同样生效（协议帧行场景）', () => {
    expect(mask('a sk-111 b sk-222')).toBe(`a ${SECRET_MASK} b ${SECRET_MASK}`);
    expect(mask('{"type":"log","msg":"got sk-9f8e7d6c"}')).toBe(
      `{"type":"log","msg":"got ${SECRET_MASK}"}`,
    );
  });

  it('无 token 原样返回（含普通文本/空串）', () => {
    expect(mask('hello world')).toBe('hello world');
    expect(mask('{"type":"result","out":{"data":1}}')).toBe('{"type":"result","out":{"data":1}}');
    expect(mask('')).toBe('');
  });

  it('边界：词边界外的 sk- 不掩码；残缺前缀不掩码', () => {
    expect(mask('mysk-abc123')).toBe('mysk-abc123'); // 'sk' 前有词字符——非独立 token
    expect(mask('sky-plan')).toBe('sky-plan'); // 无 '-' 紧随
    expect(mask('sk-')).toBe('sk-'); // 无密钥字符
  });

  it('掩码结果不再含明文子串（往返安全）', () => {
    const out = mask('sk-supersecretkey42');
    expect(out).toBe(SECRET_MASK);
    expect(out.includes('supersecretkey')).toBe(false);
  });
});
