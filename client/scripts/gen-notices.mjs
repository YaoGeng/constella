// Constella client — THIRD-PARTY-NOTICES 生成脚手架（T0-08 / S-9 义务：分发物须随附第三方许可声明）。
//
// 用法：node scripts/gen-notices.mjs（或 `pnpm -F ./client run notices`）
//
// 生成逻辑（S-9 / TDD-C-M1 §6.1g 的断言输入——NOTICE 文件须存在且覆盖依赖清单）：
//   1) 读 client/package.json 的 dependencies + devDependencies 全量清单（逐包一行，缺一即未覆盖）；
//   2) 每包许可信息按优先级取：node_modules/<pkg> 实际安装元数据与 LICENSE 文件（安装后最准）
//      → 内建 KNOWN 映射（当前依赖少，先写对 MIT / Apache-2.0 占位）→ UNKNOWN 标记 ⚠ 复核；
//   3) 输出 client/THIRD-PARTY-NOTICES.md：汇总表 + 逐包许可文本（模板文本标 ⚠ 占位）。
//
// 注意：依赖增补（P1 波 better-sqlite3、P3 波 renderer 依赖、P1/P3 波 jszip 等）后必须重跑本脚本刷新基线；
//      打包分发前以 node_modules 实际 LICENSE 文本复核（脚本已优先读取安装态，重跑即自动升级为准文本）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const pkgPath = here('../package.json');
const outPath = here('../THIRD-PARTY-NOTICES.md');
const nodeModulesDir = here('../node_modules');

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const deps = {
  ...(pkg.dependencies ?? {}),
  ...(pkg.devDependencies ?? {}),
};

// 内建已知许可映射：安装态缺失时的兜底（copyright holder 以各项目官方仓库为准，⚠ 占位待复核）。
const KNOWN = {
  electron: { license: 'MIT', holder: 'OpenJS Foundation and contributors', repo: 'https://github.com/electron/electron' },
  esbuild: { license: 'MIT', holder: 'Evan Wallace', repo: 'https://github.com/evanw/esbuild' },
  typescript: { license: 'Apache-2.0', holder: 'Microsoft Corporation', repo: 'https://github.com/microsoft/TypeScript' },
  vite: { license: 'MIT', holder: 'Evan You and Vite Contributors', repo: 'https://github.com/vitejs/vite' },
  '@types/node': { license: 'MIT', holder: 'DefinitelyTyped contributors', repo: 'https://github.com/DefinitelyTyped/DefinitelyTyped' },
};

// 许可文本模板（全文；MIT 的 holder/year 与 Apache 附录段为占位变量）。
const MIT_TEXT = (holder, years) => `MIT License

Copyright (c) ${years} ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const APACHE_2_0_TEXT = `Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.`;

/** 读取一个包的许可信息：优先安装态（node_modules），其次内建映射。 */
function resolveEntry(name, version) {
  const installedPkgJson = path.join(nodeModulesDir, ...name.split('/'), 'package.json');
  let license;
  let holder;
  let repo;
  let text;
  let source;

  if (existsSync(installedPkgJson)) {
    try {
      const meta = JSON.parse(readFileSync(installedPkgJson, 'utf8'));
      const known = KNOWN[name] ?? {};
      license = typeof meta.license === 'string' ? meta.license : known.license ?? 'UNKNOWN';
      holder = meta.author?.name ?? known.holder ?? name;
      repo = typeof meta.repository === 'string' ? meta.repository : meta.repository?.url ?? known.repo ?? '';
      // LICENSE 文件（LICENSE / LICENSE.md / LICENSE.markdown / LICENSE.txt，大小写容错取第一个命中；
      // LICENSE.markdown=T5-06 增补——jszip 3.10.2 官方 LICENSE 文件名，双许可 MIT|GPLv3 全文随附）
      const dir = path.dirname(installedPkgJson);
      const licenseFile = existsSync(dir)
        ? (['LICENSE', 'LICENSE.md', 'LICENSE.markdown', 'LICENSE.txt', 'LICENCE', 'COPYING'].find((f) =>
            existsSync(path.join(dir, f)),
          ) ?? null)
        : null;
      if (licenseFile) text = readFileSync(path.join(dir, licenseFile), 'utf8').trim();
      source = 'node_modules 安装态';
    } catch {
      source = '读取失败，回退内建映射';
    }
  }
  if (!license || !holder || !text) {
    const known = KNOWN[name] ?? {};
    license = license ?? known.license ?? 'UNKNOWN';
    holder = holder ?? known.holder ?? name;
    repo = repo ?? known.repo ?? '';
    source = source ?? '内建映射（未安装/未命中）';
  }
  if (!text) {
    if (license === 'MIT') {
      text = MIT_TEXT(`${holder} ⚠ 占位`, '【年份待复核】');
    } else if (license === 'Apache-2.0') {
      text = `${APACHE_2_0_TEXT}\n\n（注：以上为 Apache-2.0 全文模板，该包适用声明以官方仓库/LICENSE 文件为准 ⚠ 占位）`;
    } else {
      text = `⚠ 占位：许可证文本待复核（license=${license}）。请在依赖安装后重跑 gen-notices.mjs，或从 ${repo || '官方仓库'} 获取全文。`;
    }
  }
  return { name, version, license, repo, source, text };
}

const names = Object.keys(deps).sort((a, b) => a.localeCompare(b));
const entries = names.map((n) => resolveEntry(n, deps[n]));
const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
const unknown = entries.filter((e) => e.license === 'UNKNOWN' || e.text.includes('⚠')).length;

const md = `# THIRD-PARTY-NOTICES（@constella/client）

> 本文件由 \`client/scripts/gen-notices.mjs\` 生成（S-9 义务：Electron 分发物须随附第三方许可声明；
> TDD-C-M1 §6.1g 以本文件为断言输入——须存在且覆盖 client/package.json 依赖清单）。
> 生成时间：${stamp}（UTC）｜重新生成：\`pnpm -F ./client run notices\`
>
> 当前为 T0-08 基线骨架：依赖安装前以内建映射 + 许可证全文模板占位（标 ⚠ 项待复核）；
> \`pnpm install\` 后重跑脚本将自动升级为 node_modules 安装态的官方 LICENSE 文本。

## 汇总表（${entries.length} 项，须与 client/package.json 依赖清单一一对应）

| 包 | 锁定版本 | 许可证 | 信息来源 |
|---|---|---|---|
${entries.map((e) => `| ${e.name} | ${deps[e.name]} | ${e.license} | ${e.source} |`).join('\n')}

${unknown > 0 ? `> ⚠ 尚有 ${unknown} 项含占位文本，分发前须安装依赖后重跑脚本复核。\n` : ''}
## 许可文本

${entries
  .map(
    (e) => `### ${e.name} ${e.version}（${e.license}）

仓库：${e.repo || '（待补充）'}

\`\`\`
${e.text}
\`\`\``,
  )
  .join('\n\n')}
`;

writeFileSync(outPath, md, 'utf8');
console.log(`gen-notices: 写入 ${outPath}（${entries.length} 项，其中 ${unknown} 项含占位待复核）`);
if (unknown > 0) process.exitCode = 0; // 基线期允许占位；分发断言（§6.1g）由后续卡收紧
