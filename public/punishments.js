// 罰ゲームの一覧。判事はここから1つ選び、画面のルーレットで発表する。
// 恥ずかしい思いをさせない・痛くない・食べ物やおもちゃを取り上げない、笑って終われるものだけ。seconds があれば画面で数える。
export const PUNISHMENTS = [
  { id: "henkao", en: "making the funniest silly face", text: "変顔を10秒キープ", seconds: 10 },
  { id: "zou", en: "walking around the room pretending to be an elephant", text: "ゾウのまねで部屋を一周", seconds: 0 },
  { id: "homeru", en: "giving three big compliments with a smile", text: "相手のいいところを3つ言う", seconds: 0 },
  { id: "robot", en: "doing a funny robot dance", text: "ロボットダンスを15秒", seconds: 15 },
  { id: "opera", en: "singing dramatically like an opera singer", text: "「ごめんね」をオペラ風に歌う", seconds: 0 },
  { id: "hayakuchi", en: "saying a tongue twister super fast", text: "早口言葉「なまむぎなまごめなまたまご」を3回", seconds: 0 },
  { id: "oshiri", en: "wiggling its hips to write its name in the air", text: "おしりで自分の名前を書く", seconds: 0 },
  { id: "egao", en: "holding a huge forced smile", text: "10秒間ずっと笑顔でいる（笑ったら負けじゃないよ）", seconds: 10 },
  { id: "hug", en: "giving a big friendly hug", text: "仲直りのハグを5秒", seconds: 5 },
  { id: "tanuki", en: "doing a tanuki pose drumming its belly", text: "タヌキのポーズで「ポンポコポン！」", seconds: 0 },
  { id: "statue", en: "freezing in a cool superhero pose", text: "かっこいいポーズで10秒止まる", seconds: 10 },
  { id: "kotowaza", en: "shouting a friendship cheer with arms raised", text: "二人で声をそろえて「なかよしが一番！」", seconds: 0 },
];

export const punishmentList = () => PUNISHMENTS.map((p) => `${p.id}: ${p.text}`).join("\n");
