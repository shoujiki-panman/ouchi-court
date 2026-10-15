// 罰ゲームの一覧。判事はここから1つ選び、画面のルーレットで発表する。
// 恥ずかしい思いをさせない・痛くない・食べ物やおもちゃを取り上げない、笑って終われるものだけ。seconds があれば画面で数える。
export const PUNISHMENTS = [
  { id: "henkao", text: "変顔を10秒キープ", seconds: 10 },
  { id: "zou", text: "ゾウのまねで部屋を一周", seconds: 0 },
  { id: "homeru", text: "相手のいいところを3つ言う", seconds: 0 },
  { id: "robot", text: "ロボットダンスを15秒", seconds: 15 },
  { id: "opera", text: "「ごめんね」をオペラ風に歌う", seconds: 0 },
  { id: "hayakuchi", text: "早口言葉「なまむぎなまごめなまたまご」を3回", seconds: 0 },
  { id: "oshiri", text: "おしりで自分の名前を書く", seconds: 0 },
  { id: "egao", text: "10秒間ずっと笑顔でいる（笑ったら負けじゃないよ）", seconds: 10 },
  { id: "hug", text: "仲直りのハグを5秒", seconds: 5 },
  { id: "tanuki", text: "タヌキのポーズで「ポンポコポン！」", seconds: 0 },
  { id: "statue", text: "かっこいいポーズで10秒止まる", seconds: 10 },
  { id: "kotowaza", text: "二人で声をそろえて「なかよしが一番！」", seconds: 0 },
];

export const punishmentList = () => PUNISHMENTS.map((p) => `${p.id}: ${p.text}`).join("\n");
