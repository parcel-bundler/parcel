/// SHA-256, for deriving ``ContentTypeID``s. CryptoKit is not available on Linux,
/// and swift-crypto is a heavy dependency for hashing a few short strings.
struct SHA256 {
  private static let k: [UInt32] = [
    0x428a_2f98, 0x7137_4491, 0xb5c0_fbcf, 0xe9b5_dba5, 0x3956_c25b, 0x59f1_11f1, 0x923f_82a4,
    0xab1c_5ed5, 0xd807_aa98, 0x1283_5b01, 0x2431_85be, 0x550c_7dc3, 0x72be_5d74, 0x80de_b1fe,
    0x9bdc_06a7, 0xc19b_f174, 0xe49b_69c1, 0xefbe_4786, 0x0fc1_9dc6, 0x240c_a1cc, 0x2de9_2c6f,
    0x4a74_84aa, 0x5cb0_a9dc, 0x76f9_88da, 0x983e_5152, 0xa831_c66d, 0xb003_27c8, 0xbf59_7fc7,
    0xc6e0_0bf3, 0xd5a7_9147, 0x06ca_6351, 0x1429_2967, 0x27b7_0a85, 0x2e1b_2138, 0x4d2c_6dfc,
    0x5338_0d13, 0x650a_7354, 0x766a_0abb, 0x81c2_c92e, 0x9272_2c85, 0xa2bf_e8a1, 0xa81a_664b,
    0xc24b_8b70, 0xc76c_51a3, 0xd192_e819, 0xd699_0624, 0xf40e_3585, 0x106a_a070, 0x19a4_c116,
    0x1e37_6c08, 0x2748_774c, 0x34b0_bcb5, 0x391c_0cb3, 0x4ed8_aa4a, 0x5b9c_ca4f, 0x682e_6ff3,
    0x748f_82ee, 0x78a5_636f, 0x84c8_7814, 0x8cc7_0208, 0x90be_fffa, 0xa450_6ceb, 0xbef9_a3f7,
    0xc671_78f2,
  ]

  static func hash(_ message: [UInt8]) -> [UInt8] {
    var h: [UInt32] = [
      0x6a09_e667, 0xbb67_ae85, 0x3c6e_f372, 0xa54f_f53a, 0x510e_527f, 0x9b05_688c, 0x1f83_d9ab,
      0x5be0_cd19,
    ]

    var data = message
    data.append(0x80)
    while data.count % 64 != 56 { data.append(0) }
    let bitLength = UInt64(message.count) * 8
    for shift in stride(from: 56, through: 0, by: -8) {
      data.append(UInt8(truncatingIfNeeded: bitLength >> UInt64(shift)))
    }

    var w = [UInt32](repeating: 0, count: 64)
    for chunk in stride(from: 0, to: data.count, by: 64) {
      for i in 0..<16 {
        let j = chunk + i * 4
        w[i] =
          UInt32(data[j]) << 24 | UInt32(data[j + 1]) << 16 | UInt32(data[j + 2]) << 8
          | UInt32(data[j + 3])
      }
      for i in 16..<64 {
        let s0 = w[i - 15].rotatedRight(7) ^ w[i - 15].rotatedRight(18) ^ (w[i - 15] >> 3)
        let s1 = w[i - 2].rotatedRight(17) ^ w[i - 2].rotatedRight(19) ^ (w[i - 2] >> 10)
        w[i] = w[i - 16] &+ s0 &+ w[i - 7] &+ s1
      }

      var (a, b, c, d, e, f, g, hh) = (h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7])
      for i in 0..<64 {
        let s1 = e.rotatedRight(6) ^ e.rotatedRight(11) ^ e.rotatedRight(25)
        let ch = (e & f) ^ (~e & g)
        let t1 = hh &+ s1 &+ ch &+ k[i] &+ w[i]
        let s0 = a.rotatedRight(2) ^ a.rotatedRight(13) ^ a.rotatedRight(22)
        let maj = (a & b) ^ (a & c) ^ (b & c)
        let t2 = s0 &+ maj
        (hh, g, f, e, d, c, b, a) = (g, f, e, d &+ t1, c, b, a, t1 &+ t2)
      }
      h[0] &+= a
      h[1] &+= b
      h[2] &+= c
      h[3] &+= d
      h[4] &+= e
      h[5] &+= f
      h[6] &+= g
      h[7] &+= hh
    }

    return h.flatMap { word in
      [24, 16, 8, 0].map { UInt8(truncatingIfNeeded: word >> UInt32($0)) }
    }
  }
}

extension UInt32 {
  fileprivate func rotatedRight(_ count: UInt32) -> UInt32 {
    (self >> count) | (self << (32 - count))
  }
}
