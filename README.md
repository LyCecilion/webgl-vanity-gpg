# webgl-vanity-gpg

使用 GPU（WebGL）快速生成带有“靓号”的 PGP 密钥！

“靓号”指的是带有连号等特定格式的密钥指纹或 ID（例如以 `77777777` 结尾），具体介绍和生成原理请参见：

* [一位 PGP 进步青年的科学算号实践](https://www.douban.com/note/763978955/)
* [某科学的 PGP 算号指南](https://blog.dejavu.moe/posts/the-scientific-vanity-pgp-counting-guide/)

![](https://github.com/user-attachments/assets/e6364d93-fffe-4fcd-9857-b70155e6f476)

简单来说，密钥指纹是密钥生效时间和公钥内容的 SHA-1，通过不断生成密钥和修改时间（成本更低）的暴力遍历方式找到“靓号”。

目前速度最快的算号工具，例如使用 CPU 的 [RedL0tus/VanityGPG](https://github.com/RedL0tus/VanityGPG) 和使用 GPU 的 [cuihaoleo/gpg-fingerprint-filter-gpu](https://github.com/cuihaoleo/gpg-fingerprint-filter-gpu)，都只能在 Linux 下运行，后者还需要准备 CUDA 环境。但是我是 Windows 用户，又觉得开虚拟机跑 VanityGPG 太慢了，更没有多余的显卡拿去直通给虚拟机，所以就写了这个。

能在浏览器上运行的话那应该就方便多了！(๑•̀ᄇ•́)و ✧

## 本地生命周期工具的时间约定

开发环境使用 Node 24 和 pnpm 10.11.0，执行 `pnpm install --frozen-lockfile`；日期行为可用 `pnpm test` 验证。

创建时间搜索支持指定自然日、任务启动当天和自定义闭区间，并明确选择本机时区或 UTC。任务启动时冻结区间：排除未来秒，子钥还排除早于主钥创建时间的秒；空区间直接报错，不扩展到其他日期。本机自然日按相邻午夜计算，兼容夏令时的 23/25 小时日，拒绝不存在的日期或本地时刻。

到期日期表示该日全天可用，在所选时区下一日零点失效；创建时间与签发时间不是同一个时间。

## 证书签发与续期 API

`src/key-lifecycle.ts` 提供可独立执行的生命周期 API：先创建 v4 Ed25519 **仅认证 [C]** 主钥，再向已投入使用的主钥追加独立的 Ed25519 [S] 或 Curve25519 [E] 子钥。签名子钥带有可验证的交叉认证；新自认证只声明 GnuPG 支持的 AES、SHA-512/SHA-256 和压缩偏好。

`KeyDocument.bytes` 是导入及导出的权威来源，语义解析对象仅用于验证和签发。追加和续期只插入新包，保留原指纹、密钥材料、创建时间、UID、历史认证、撤销和未知非关键包；旧 EOF 不定长末包仅规范化包头以免吞掉新增包。公开导出仅替换秘密包，不包含秘密材料。

续期接受完整指纹，不允许缩短期限或复活已撤销的密钥。仅密钥生命周期已到期时仍可续期；签名自身无效或已到期不算可续期身份。有效签名子钥交叉认证可复用，只需主钥口令；失效交叉认证需要相应子钥材料与口令。非空保护口令始终加密，空口令仅在明确允许未加密时接受。

`node --experimental-strip-types --test tests/key-lifecycle.test.ts` 使用真实 OpenPGP.js 和隔离的 GnuPG 临时 keyring 验证签名、解密、历史包保留、期限与失败原子性，不使用个人 GnuPG 配置。

## 类似工具和性能对比

| Repo | 计算方式 | 速度（hash/s） | 注释 |
| - | - | - | - |
| [Erriy/gpg_awesome_keyid](https://github.com/Erriy/gpg_awesome_keyid) | CPU | 17k | i5-5200U x4 |
| [nc7s/g3k](https://github.com/nc7s/g3k) | CPU | 430k | M1 Pro x8 |
| [RedL0tus/VanityGPG](https://github.com/RedL0tus/VanityGPG) | CPU | 120m | Ryzen 7 3700x x16 |
| [lachesis/scallion](https://github.com/lachesis/scallion) | GPU |  | 仅支持 RSA，已停止更新 |
| [Victrid/memorable-pgpgen](https://github.com/Victrid/memorable-pgpgen) | GPU |  | 没有给出速度 |
| [cuihaoleo/gpg-fingerprint-filter-gpu](https://github.com/cuihaoleo/gpg-fingerprint-filter-gpu) | GPU | 10b | RTX 3090 数据来自“算号指南” |
| 这个项目 | GPU | 1b | Radeon 680M |
| 这个项目 | GPU | 2b | GTX 1070 |
| 这个项目 | GPU | 7b | RTX A5500 |
| 这个项目 | GPU | 7b | Radeon RX 7700 XT |

以上的速度均为生成 Curve25519 类型的密钥的速度。

## 合并主密钥和子密钥

这个工具在生成密钥时只能保证主密钥和子密钥**其中之一**的指纹为“靓号”。如果你希望生成主密钥和子密钥的指纹都是“靓号”的密钥：

1. 生成主密钥为“靓号”的私钥 A。
2. 生成子密钥为“靓号”的私钥 B（需要勾选“将格式应用到子密钥而不是主密钥上”）。
3. 点击“把不同密钥的“靓号”合并到一起！”，粘贴私钥 A 和私钥 B，然后保存合并后的私钥。
4. 导入新的私钥后，自行使用 `gpg --edit-key` 编辑私钥。
