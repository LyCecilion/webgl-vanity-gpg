#version 300 es

precision highp float;
precision highp int;

#define ROTL(x, n) (((x) << (n)) | ((x) >> (32 - (n))))

// LENGTH (uint32 words) and BLOCKS (64-byte SHA-1 chunks) are replaced once per
// search with the size of the hashed key packet. Nothing else is injected: the
// fingerprint prefix is matched through the prefixWord/prefixMask uniforms.
#define __INJECTS__
#ifdef __INJECTS__
#define LENGTH (0)
#define BLOCKS (0)
#endif

uniform uint width;
uniform uint height;
// Real iterations for this draw: ceil(batchCount / (width * height)).
uniform uint iteration;
// Highest creation timestamp of the batch; the batch walks downwards from here.
uniform uint batchEnd;
// Number of timestamps in the batch, at most width * height * iteration.
uniform uint batchCount;
// Number of leading fingerprint words and their expected value/mask.
uniform uint prefixWordCount;
uniform uint prefixWord[5];
uniform uint prefixMask[5];
// SHA-1 input of the candidate public key packet, already padded and byte swapped.
uniform uint hashData[LENGTH];

out uvec4 outColor;

// Each fragment hashes unique creation timestamps of one candidate key:
//   offset    = iteration * width * height + pixel
//   timestamp = batchEnd - offset
// The result is [foundFlag, timestamp, actualHashesForThisPixel, 0]; timestamp 0
// is a valid hit, an unused lane is distinguished by foundFlag == 0.
void main() {
    uint data[LENGTH];
    for (int i = 0; i < LENGTH; i++) data[i] = hashData[i];

    uint capacity = width * height;
    uint pixel = uint(gl_FragCoord.x) + uint(gl_FragCoord.y) * width;
    uint attempts = 0u;
    uint found = 0u;
    uint timestamp = 0u;

    for (uint iter = 0u; iter < iteration; iter++) {
        uint offset = iter * capacity + pixel;
        if (offset >= batchCount) break;

        // data[1] is the creation time word of the v4 key packet hash input.
        uint created = batchEnd - offset;
        data[1] = created;

        uint h[] = uint[](
            0x67452301u,
            0xEFCDAB89u,
            0x98BADCFEu,
            0x10325476u,
            0xC3D2E1F0u
        );

        for (int chunk = 0; chunk < BLOCKS; chunk++) {
            uint w[80];
            for (int i = 0; i < 16; i++) w[i] = data[chunk * 16 + i];
            for (int i = 16; i < 80; i++) w[i] = ROTL(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);

            uint a = h[0];
            uint b = h[1];
            uint c = h[2];
            uint d = h[3];
            uint e = h[4];
            uint f;
            uint k;
            uint t;

            for (int i = 0; i < 80; i++) {
                if (i < 20) {
                    f = d ^ (b & (c ^ d));
                    k = 0x5A827999u;
                } else if (i < 40) {
                    f = b ^ c ^ d;
                    k = 0x6ED9EBA1u;
                } else if (i < 60) {
                    f = (b & c) | (b & d) | (c & d);
                    k = 0x8F1BBCDCu;
                } else {
                    f = b ^ c ^ d;
                    k = 0xCA62C1D6u;
                }
                t = ROTL(a, 5) + f + e + k + w[i];
                e = d;
                d = c;
                c = ROTL(b, 30);
                b = a;
                a = t;
            }

            h[0] += a;
            h[1] += b;
            h[2] += c;
            h[3] += d;
            h[4] += e;
        }

        attempts += 1u;

        bool matched = (prefixWordCount > 0u) && ((h[0] & prefixMask[0]) == prefixWord[0]);
        if (prefixWordCount > 1u) matched = matched && ((h[1] & prefixMask[1]) == prefixWord[1]);
        if (prefixWordCount > 2u) matched = matched && ((h[2] & prefixMask[2]) == prefixWord[2]);
        if (prefixWordCount > 3u) matched = matched && ((h[3] & prefixMask[3]) == prefixWord[3]);
        if (prefixWordCount > 4u) matched = matched && ((h[4] & prefixMask[4]) == prefixWord[4]);

        if (matched) {
            found = 1u;
            timestamp = created;
            break;
        }
    }

    outColor = uvec4(found, timestamp, attempts, 0u);
}
