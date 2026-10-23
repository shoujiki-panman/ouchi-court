// ふたりで対戦：名前の見分け方（書記官の「呼びかけ」と、子どもの「名乗り」）
// - 呼びかけ = 「〇〇さん、」「〇〇さんですね」「〇〇さんはどう思う？」「〇〇さんどう思う？」など（addressKind）。
//   「アカさんに」「アオさんから」「アオさんは名前が…。」のような言及は呼びかけに数えない（10/23 相手の名前で取り違えた）
// - 書記官は短く呼ぶことがある（デモテストアオ → アオ）ので、名前の末尾（2文字以上）でも照合する
// - 子どもの席は、本人の名乗り（「〇〇です」「わたしは〇〇です」）だけで決める（相手の名前を言っただけでは動かさない）
const NAME_CHAR = /[ァ-ヶーぁ-ん一-龠A-Za-z]/;

// 語の末尾がどの参加者の名前（または名前の末尾2文字以上）と一致するか。長く一致した方。同じ長さなら決めない（-1）
function partyByTail(word, parties) {
  let best = -1, bestLen = 0, tie = false;
  parties.forEach((p, i) => {
    if (!p) return;
    for (let k = p.length; k >= Math.min(2, p.length); k--) {
      if (word.endsWith(p.slice(-k))) {
        if (k > bestLen) { best = i; bestLen = k; tie = false; } else if (k === bestLen) tie = true;
        break;
      }
    }
  });
  return tie ? -1 : best;
}

// 「さん」の直前の語（名前の文字が続く所まで）
function wordBefore(text, end) {
  let i = end;
  while (i > 0 && NAME_CHAR.test(text[i - 1])) i--;
  return text.slice(i, end);
}

// 「さん」のあとが呼びかけか（言及か）。
//  呼びかけ: 、！？ が続く／ですね・で合って
//  言及: に・の・が・を・から・と・も・へ・より・まで・って・だ・で が続く
//  「は」が続く／助詞なし（「モモさんはどう思いますか？」「モモさんどう思う？」）: その文が ？ で終わるときだけ呼びかけ（"question"）。
//    「モモさんは名前が…ですね。」は言及。同じ文の中に 、 つきの呼びかけが先にあれば、そちらを優先する
//    （「クリさん、モモさんはどう思っているかな？」はクリへの問い）
//  文がまだ終わっていない（断片）ときは決めない
function addressKind(text, after) {
  const rest = text.slice(after);
  if (/^([、,！!？?]|ですね|で合って)/.test(rest)) return "vocative";
  if (/^(に|の|が|を|から|と|も|へ|より|まで|って|だ|で)/.test(rest)) return null;
  const end = rest.search(/[。！？!?\n]/);
  if (end < 0) return null; // 文の終わりがまだ届いていない
  return rest[end] === "？" || rest[end] === "?" ? "question" : null;
}

// 書記官のせりふで、最後に呼びかけた参加者の番号（0=原告, 1=被告）。呼びかけが無ければ -1
export function addressedParty(text = "", parties = []) {
  // 役名は「被告の人、」「原告の方、」でも呼びかけ（10/24「被告の人、名前を教えてくれるかな？」を拾えず、被告の名乗りで原告の席が光った）
  const re = /さん|(?<=原告|被告)(?:の人|の方)/g;
  let found = -1, vocativeAt = -1, m;
  while ((m = re.exec(text))) {
    const kind = addressKind(text, m.index + m[0].length);
    if (!kind) continue;
    if (kind === "question" && vocativeAt >= 0 && !/[。！？!?\n]/.test(text.slice(vocativeAt, m.index))) continue;
    const word = wordBefore(text, m.index);
    if (!word) continue;
    let who = partyByTail(word, parties);
    if (who < 0) who = word.endsWith("原告") ? 0 : word.endsWith("被告") ? 1 : -1;
    if (who < 0) continue;
    found = who;
    if (kind === "vocative") vocativeAt = m.index + m[0].length;
  }
  return found;
}

// 子どもの発言の冒頭の名乗りで、本人の番号。名乗りでなければ -1
export function selfNamedParty(text = "", parties = []) {
  const m = text.trim().match(/^(?:わたしは|私は|ぼくは|僕は|おれは|俺は)?\s*([ァ-ヶーぁ-ん一-龠A-Za-z]{1,12}?)(?:です|だよ)/);
  if (!m) return -1;
  return partyByTail(m[1], parties);
}
