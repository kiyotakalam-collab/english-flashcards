// All questions below are original examples, not transcriptions of commercial books or exams.
const groups = [
  ['文の基本構造', [['sentence-pattern','文型'],['tense','時制'],['modal','助動詞'],['passive','受動態'],['infinitive','不定詞'],['gerund','動名詞'],['participle','分詞']]],
  ['複文・修飾', [['relative-pronoun','関係代名詞'],['relative-adverb','関係副詞'],['nonrestrictive','非制限用法'],['noun-clause','名詞節'],['indirect-question','間接疑問'],['appositive-that','同格のthat'],['conjunction','接続詞'],['participial-clause','分詞構文']]],
  ['応用表現', [['subjunctive','仮定法'],['comparison','比較'],['cleft','強調構文'],['inversion','倒置'],['inanimate-subject','無生物主語'],['formal-it','形式主語・形式目的語'],['causative','使役動詞'],['perception','知覚動詞']]],
  ['語法', [['article','冠詞'],['preposition','前置詞'],['countability','可算・不可算'],['number','単数・複数'],['agreement','主述一致'],['verb-usage','動詞の語法'],['word-order','語順'],['collocation','コロケーション']]]
];
export const GRAMMAR = groups.flatMap(([group, tags]) => tags.map(([id, label]) => ({id, label, group, important: true})));
export const ERROR_CATEGORIES = [
  ['structure','文構造'],['tense','時制'],['agreement','主述一致'],['relative','関係詞'],['article','冠詞'],['preposition','前置詞'],['verb-usage','動詞の語法'],['number','単複・可算不可算'],['word-order','語順'],['vocabulary','語彙選択'],['meaning','日本語の意味の取り違え'],['naturalness','不自然な英語表現'],['other','その他']
].map(([id,label])=>({id,label}));
export const DIFFICULTIES = [{id:'basic',label:'基礎'},{id:'standard',label:'標準'},{id:'advanced',label:'難関私大'},{id:'keio',label:'慶應文学部対策'}];
export const EXAM_DATE = '2027-02-15';
const created = '2026-11-10T00:00:00.000Z';
// tag, difficulty, Japanese, multiple reference examples, explanation.
const examples = [
 ['sentence-pattern','basic','私の姉は私に古い地図をくれた。',['My sister gave me an old map.','My sister gave an old map to me.'],'目的語が2つある文型と、toを使う言い換えを比べましょう。'],
 ['sentence-pattern','standard','その知らせは私たちを幸せにした。',['The news made us happy.','We were made happy by the news.'],'make + 目的語 + 補語。happyはusの状態を説明します。'],
 ['tense','basic','私は昨日その図書館を訪れた。',['I visited the library yesterday.','Yesterday, I visited the library.'],'yesterdayは過去の特定時点を表します。'],
 ['tense','standard','彼女が着いたとき、会議はすでに始まっていた。',['The meeting had already started when she arrived.','When she arrived, the meeting had already begun.'],'到着より前の開始を過去完了で示せます。'],
 ['modal','basic','ここでは静かにしなければならない。',['You must be quiet here.','You have to be quiet here.'],'義務の意味を保持しましょう。'],
 ['modal','standard','彼はその知らせを聞いて驚いたに違いない。',['He must have been surprised to hear the news.','Hearing the news must have surprised him.'],'過去の出来事の推量はmust have + 過去分詞。'],
 ['passive','basic','この橋は50年前に建てられた。',['This bridge was built fifty years ago.','Fifty years ago, this bridge was built.'],'be + 過去分詞。建設時期は過去です。'],
 ['passive','standard','その計画は今、専門家たちによって検討されている。',['The plan is now being considered by experts.','Experts are now considering the plan.'],'進行中の受動態はis being considered。能動態でも意味が保たれれば妥当です。'],
 ['infinitive','basic','私は留学するためにお金を貯めている。',['I am saving money to study abroad.','I am saving money in order to study abroad.'],'目的を表すto不定詞を確認します。'],
 ['infinitive','standard','彼女には相談できる友人がいる。',['She has a friend to talk to.','She has a friend she can consult.'],'talk toでは前置詞toを落とさないよう注意。'],
 ['gerund','basic','私は朝、公園を歩くことを楽しんでいる。',['I enjoy walking in the park in the morning.','In the morning, I enjoy walking in the park.'],'enjoyの目的語には動名詞を用います。'],
 ['gerund','standard','彼はその窓を壊したことを否定した。',['He denied breaking the window.','He denied having broken the window.'],'deny + 動名詞。過去の行為をhaving brokenで明確にもできます。'],
 ['participle','basic','入口で待っている女性は私の先生です。',['The woman waiting at the entrance is my teacher.','The woman who is waiting at the entrance is my teacher.'],'waitingがwomanを修飾します。'],
 ['participle','standard','私はその知らせに驚いている学生たちを見た。',['I saw the students surprised by the news.','I saw the students who were surprised by the news.'],'驚かされた側はsurprisedを使います。'],
 ['relative-pronoun','standard','私が昨日会った研究者はこの町に住んでいる。',['The researcher I met yesterday lives in this town.','The researcher whom I met yesterday lives in this town.'],'関係節内の目的語をhim/herで重複させません。主節の主語はresearcherです。'],
 ['relative-pronoun','advanced','私は、近所の人がみな信頼している医師を知っている。',['I know a doctor whom everyone in the neighborhood trusts.','I know a doctor everyone in the neighborhood trusts.'],'目的格の関係代名詞とhim/herを二重に置かず、everyone trustsと一致させます。'],
 ['relative-adverb','standard','ここは私たちが初めて出会った場所です。',['This is the place where we first met.','This is where we first met.'],'whereは場所を表し、関係節内で場所の副詞として働きます。'],
 ['relative-adverb','advanced','彼女が突然計画を変えた理由が分からない。',['I do not know why she suddenly changed her plan.','I do not understand the reason she suddenly changed her plan.'],'whyの後ろは平叙文の語順にします。'],
 ['nonrestrictive','advanced','私の兄は大阪に住んでいるのだが、来週私たちを訪ねる。',['My brother, who lives in Osaka, will visit us next week.','My brother lives in Osaka and will visit us next week.'],'非制限用法は既に特定された対象に情報を加えます。'],
 ['nonrestrictive','keio','彼は私の提案を断ったが、それは私を驚かせなかった。',['He rejected my proposal, which did not surprise me.','He turned down my suggestion, but that did not surprise me.'],'whichが前の節の内容全体を受ける用法です。'],
 ['noun-clause','standard','彼が正直であることは誰もが知っている。',['Everyone knows that he is honest.','Everybody knows he is honest.'],'that節がknowsの目的語になります。'],
 ['noun-clause','advanced','私たちに必要なのは、より多くの情報ではなく、考える時間だ。',['What we need is time to think, not more information.','We need time to think rather than more information.'],'名詞節what we needと対比の意味を保ちます。'],
 ['indirect-question','standard','駅がどこにあるか教えていただけますか。',['Could you tell me where the station is?','Can you tell me where the station is?'],'間接疑問はwhere the station isという語順です。'],
 ['indirect-question','advanced','彼女がなぜその仕事を選んだのか知りたい。',['I would like to know why she chose that job.','I want to know why she chose the job.'],'why did she chooseとはしません。'],
 ['appositive-that','advanced','彼が戻ってくるという知らせは私たちを安心させた。',['The news that he would return reassured us.','We were reassured by the news that he would come back.'],'newsの内容を説明する同格のthat節です。'],
 ['appositive-that','keio','知識があれば必ず賢い判断ができるという考えには同意できない。',['I disagree with the idea that knowledge always leads to wise decisions.','I cannot agree with the belief that knowledge necessarily enables wise judgment.'],'ideaの内容を示し、必ずという強い主張を否定する意味を落としません。'],
 ['conjunction','basic','雨が降っていたので、私たちは家にいた。',['We stayed home because it was raining.','Because it was raining, we stayed at home.'],'理由と結果を逆にしないよう注意。'],
 ['conjunction','advanced','たとえ誰も賛成しなくても、私は自分の意見を述べる。',['Even if no one agrees with me, I will express my opinion.','I will state my opinion even if nobody agrees.'],'even ifは仮定条件を表します。'],
 ['participial-clause','advanced','どうすればよいか分からず、私は先生に助言を求めた。',['Not knowing what to do, I asked my teacher for advice.','Since I did not know what to do, I asked my teacher for advice.'],'分詞構文の意味上の主語を主節のIと一致させます。'],
 ['participial-clause','keio','その報告書を注意深く読んでから、彼女は結論を変えた。',['Having read the report carefully, she changed her conclusion.','After reading the report carefully, she changed her conclusion.'],'先に読むという時間関係を保ちます。'],
 ['subjunctive','standard','もっと時間があれば、その本を読めるのに。',['If I had more time, I could read the book.','I could read that book if I had more time.'],'現在の事実に反する仮定ではhadとcouldを組み合わせます。'],
 ['subjunctive','advanced','あなたの助言がなければ、私はその間違いを犯していただろう。',['Without your advice, I would have made that mistake.','If it had not been for your advice, I would have made that mistake.'],'過去の反事実にはwould have + 過去分詞を使います。'],
 ['comparison','basic','この部屋はあの部屋より明るい。',['This room is brighter than that one.','That room is less bright than this one.'],'比較対象を明確にし、意味の向きを保ちます。'],
 ['comparison','keio','情報が多ければ多いほど、正しい選択が容易になるとは限らない。',['Having more information does not necessarily make it easier to make the right choice.','Having more information does not always make choosing correctly easier.'],'比較と部分否定の両方が必要です。参考英文は唯一の正解ではありません。'],
 ['cleft','advanced','私たちにその可能性を教えてくれたのは彼女だった。',['It was she who told us about that possibility.','She was the one who told us about that possibility.'],'強調構文It was ... who ...で人物を強調します。'],
 ['cleft','keio','私が理解したのは、彼の説明ではなく、彼が挙げた具体例だった。',['It was the example he gave, not his explanation, that I understood.','What I understood was the example he gave rather than his explanation.'],'対比の焦点を保ちます。'],
 ['inversion','advanced','私はこれほど静かな場所を見たことがない。',['Never have I seen such a quiet place.','I have never seen such a quiet place.'],'否定語を文頭に置くと助動詞と主語が倒置します。通常語順も意味は妥当です。'],
 ['inversion','keio','家に帰って初めて、私は鍵をなくしたことに気づいた。',['Only when I got home did I realize that I had lost my key.','I did not realize I had lost my key until I got home.'],'only whenを前置した場合の主節の倒置に注意。'],
 ['inanimate-subject','standard','激しい雨のために、私たちは外出できなかった。',['The heavy rain prevented us from going out.','We could not go out because of the heavy rain.'],'prevent + 目的語 + from -ingという語法を確認。'],
 ['inanimate-subject','advanced','この経験によって、私は他人の意見に耳を傾けることの大切さを学んだ。',['This experience taught me the importance of listening to others.','Through this experience, I learned how important it is to listen to other people.'],'経験を主語にできます。相手の意見を聞く意味を保ちます。'],
 ['formal-it','standard','自分の考えを英語で説明することは私には難しい。',['It is difficult for me to explain my ideas in English.','I find it difficult to explain my ideas in English.'],'形式主語と形式目的語のどちらも意味が合えば妥当です。'],
 ['formal-it','advanced','私は、失敗から学ぶことが重要だと思う。',['I think it is important to learn from failure.','I consider it important to learn from failures.'],'itと真の内容to不定詞の関係を確認します。'],
 ['causative','standard','母は私に自分の部屋を掃除させた。',['My mother made me clean my room.','My mother had me clean my room.'],'make/have + 目的語 + 原形。letは許可に意味が変わる場合があります。'],
 ['causative','advanced','私は昨日自転車を修理してもらった。',['I had my bicycle repaired yesterday.','I got my bike repaired yesterday.'],'have/get + 目的語 + 過去分詞は依頼した結果を表します。'],
 ['perception','standard','私は彼女が部屋に入るのを見た。',['I saw her enter the room.','I saw her entering the room.'],'原形は動作全体、-ingは進行場面に焦点があります。'],
 ['perception','advanced','私は隣の部屋で誰かが歌っているのを聞いた。',['I heard someone singing in the next room.','I heard somebody sing in the next room.'],'知覚動詞の目的語のあとに動作を置きます。'],
 ['article','basic','私は犬を見つけ、その犬を家に連れて帰った。',['I found a dog and took it home.','I found a dog, and I took the dog home.'],'初出はa、既知になった対象はtheまたは代名詞です。'],
 ['article','standard','太陽は東から昇る。',['The sun rises in the east.','In the east, the sun rises.'],'唯一物と方角の冠詞を確認します。'],
 ['preposition','basic','彼女は午後3時に駅に着いた。',['She arrived at the station at three in the afternoon.','She got to the station at 3 p.m.'],'arrive at / get toと時刻のatに注意します。'],
 ['preposition','standard','私はその計画に反対している。',['I am opposed to the plan.','I am against the plan.'],'opposed toで一つの表現です。'],
 ['countability','basic','その件について助言をいただけますか。',['Could you give me some advice on the matter?','Can you give me a piece of advice about that matter?'],'adviceは通常不可算名詞です。'],
 ['countability','standard','この研究にはさらに多くの情報が必要だ。',['This research needs more information.','More information is needed for this study.'],'researchとinformationの可算性に注意。'],
 ['number','basic','この箱にはりんごが3個入っている。',['There are three apples in this box.','This box contains three apples.'],'threeの後の名詞とthere areの一致を確認。'],
 ['number','standard','この町の子供たちは毎日歩いて学校に通う。',['The children in this town walk to school every day.','Children in this town go to school on foot every day.'],'childの複数形とevery dayの使い方を確認します。'],
 ['agreement','basic','誰もが自分の意見を持っている。',['Everyone has their own opinion.','Everybody has an opinion of their own.'],'everyoneは単数扱いです。単数theyは妥当な用法です。'],
 ['agreement','advanced','私が昨日借りた本のうちの1冊はとても面白い。',['One of the books I borrowed yesterday is very interesting.','One of the books that I borrowed yesterday is very interesting.'],'主語の中心はoneなのでisになります。'],
 ['verb-usage','standard','私たちはその問題について昨日話し合った。',['We discussed the problem yesterday.','We talked about the problem yesterday.'],'discussは他動詞なのでaboutを直接続けません。'],
 ['verb-usage','advanced','彼女は私にその仕事に応募するよう勧めた。',['She encouraged me to apply for the job.','She advised me to apply for the job.'],'人に何かを勧める動詞とto不定詞の語法を確認。'],
 ['word-order','basic','彼はたいてい朝早く起きる。',['He usually gets up early in the morning.','Usually, he gets up early in the morning.'],'頻度副詞の位置を確認します。'],
 ['word-order','standard','私は彼女が何を言いたいのか分からない。',['I do not understand what she wants to say.','I cannot understand what she means.'],'名詞節内は平叙文の語順です。'],
 ['collocation','basic','私は昨日重要な決断をした。',['I made an important decision yesterday.','Yesterday, I made an important decision.'],'make a decisionという組み合わせを確認。'],
 ['collocation','standard','私たちはその違いに注意を払うべきだ。',['We should pay attention to the difference.','We ought to pay attention to that difference.'],'pay attention toの組み合わせを学びます。']
];
export const QUESTIONS = examples.map(([tag,difficulty,japanese,reference_answers,explanation],index)=>({
 id:`writing-original-${String(index+1).padStart(3,'0')}`,mode:'short',japanese,reference_answers,grammar_tags:[tag],difficulty,
 source:'original',source_detail:'アプリ独自作成。教材・過去問の転載ではありません。',explanation,active:true,created_at:created,updated_at:created
}));
for (const [index,japanese] of [
 '学校での学びにおいて、他者との対話はどのような役割を果たすか。自分の意見と理由を英語で述べてください。',
 '情報を簡単に得られる社会で、物事を自分で考えることが重要なのはなぜか。自分の立場を英語で説明してください。',
 '地域の図書館を充実させることと、オンラインの学習環境を整えることでは、どちらを優先すべきか。理由を添えて述べてください。',
 '失敗する可能性のある新しい挑戦を若者に勧めるべきか。具体例を交えてあなたの意見を述べてください。'
].entries()) QUESTIONS.push({id:`writing-essay-${index+1}`,mode:'essay',japanese,reference_answers:[],grammar_tags:['noun-clause','conjunction'],difficulty:index===3?'keio':'advanced',source:'original',source_detail:'アプリ独自の自由英作文テーマ。公式試験の設問ではありません。',explanation:'主張・理由・具体例・結論のつながりを確認し、修正時も元の主張を保ちましょう。',active:true,created_at:created,updated_at:created});

/** Original, slot-generated relative-clause probes: never represented as AI output. */
export function generateVariant(grammarId, seed = 0, now = new Date().toISOString()) {
  if (grammarId !== 'relative-pronoun') return null;
  const contexts = [
    ['作家','writer','読者','readers','尊敬している','respect'],
    ['医師','doctor','患者','patients','信頼している','trust'],
    ['選手','athlete','子供たち','children','応援している','support'],
    ['研究者','researcher','学生たち','students','称賛している','admire']
  ];
  const i = Math.abs(Math.trunc(seed)) % contexts.length;
  const [jpNoun,noun,jpGroup,group,jpVerb,verb] = contexts[i];
  return {id:`writing-generated-relative-${crypto.randomUUID()}`,mode:'short',japanese:`私は、${jpGroup}がみな${jpVerb}${jpNoun}に昨日会った。`,reference_answers:[`Yesterday, I met a ${noun} whom all the ${group} ${verb}.`,`Yesterday, I met a ${noun} that all the ${group} ${verb}.`],grammar_tags:[grammarId],difficulty:'advanced',source:'original',source_detail:'目的格関係詞の重複を確認するテンプレート生成類題（AI生成ではありません）。',explanation:'関係節の目的語をhim/herなどで重複させず、all the ... + 動詞の主述一致と「昨日会った」という意味を確認します。',active:true,created_at:now,updated_at:now};
}
