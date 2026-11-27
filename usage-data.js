export const CATEGORIES = ['動詞語法', '形容詞語法', '名詞語法', '定型表現', '前置詞', 'その他'];
const rows = [
  ['Aに気を散らされる', 'be distracted by A', 'I was distracted by the noise.', '動詞語法'],
  ['Aに囲まれている', 'be surrounded by A', 'We are surrounded by information.', '動詞語法'],
  ['Aの代わり', 'a substitute for A', 'This cannot be a substitute for experience.', '名詞語法'],
  ['〜しそうだ', 'be likely to do', 'Students are likely to make mistakes.', '形容詞語法'],
  ['Aを利用できる', 'have access to A', 'Students have access to computers.', '定型表現'],
  ['Aが利用できる', 'be available to A', 'This service is available to students.', '形容詞語法'],
  ['Aに巻き込まれる', 'be involved in A', 'He was involved in an accident.', '動詞語法'],
  ['〜する危険を冒す', 'run the risk of doing', 'You run the risk of getting hurt.', '定型表現'],
  ['Aについて学ぶ', 'learn about A', 'We can learn about other cultures.', '動詞語法'],
  ['〜して時間を使う', 'spend time doing', 'Students spend time studying.', '定型表現'],
  ['Aに時間を使う', 'spend time on A', 'Do not spend too much time on games.', '定型表現'],
  ['Aを健康な状態に保つ', 'keep A healthy', 'Exercise helps keep us healthy.', '動詞語法'],
  ['病気になる', 'get sick', 'You should rest if you get sick.', '定型表現'],
  ['ストレスを感じる', 'get stressed', 'Students sometimes get stressed.', '定型表現'],
  ['ほっとする', 'feel relieved', 'I felt relieved after the test.', '形容詞語法'],
  ['寂しさが和らぐ', 'feel less lonely', 'Pets can help elderly people feel less lonely.', '定型表現'],
  ['Aを獣医に連れていく', 'take A to a vet', 'You should take your pet to a vet.', '動詞語法'],
  ['自分だけの時間を持つ', 'have some time to yourself', 'It is important to have some time to yourself.', '定型表現'],
  ['Aということを認識している', 'be aware that S V', 'We should be aware that our actions affect others.', '形容詞語法'],
  ['環境を害する', 'damage the environment', 'Plastic waste can damage the environment.', '動詞語法']
];
export const INITIAL_ITEMS = rows.map(([Japanese, English, example, category], index) => ({
  id: `usage-${String(index + 1).padStart(3, '0')}`, Japanese, English, example, category, active: true,
  created_at: '2026-11-27T00:00:00.000Z', updated_at: '2026-11-27T00:00:00.000Z'
}));
