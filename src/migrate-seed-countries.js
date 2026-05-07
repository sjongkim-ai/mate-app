import { pool, query } from './db.js';

// [code, code3, name_ko, name_en, continent_code, calling_code, currency_code]
const COUNTRIES = [
  // Asia
  ['KR','KOR','대한민국','South Korea','AS','+82','KRW'],
  ['JP','JPN','일본','Japan','AS','+81','JPY'],
  ['CN','CHN','중국','China','AS','+86','CNY'],
  ['HK','HKG','홍콩','Hong Kong','AS','+852','HKD'],
  ['TW','TWN','대만','Taiwan','AS','+886','TWD'],
  ['MO','MAC','마카오','Macao','AS','+853','MOP'],
  ['MN','MNG','몽골','Mongolia','AS','+976','MNT'],
  ['VN','VNM','베트남','Vietnam','AS','+84','VND'],
  ['TH','THA','태국','Thailand','AS','+66','THB'],
  ['LA','LAO','라오스','Laos','AS','+856','LAK'],
  ['KH','KHM','캄보디아','Cambodia','AS','+855','KHR'],
  ['MM','MMR','미얀마','Myanmar','AS','+95','MMK'],
  ['MY','MYS','말레이시아','Malaysia','AS','+60','MYR'],
  ['SG','SGP','싱가포르','Singapore','AS','+65','SGD'],
  ['ID','IDN','인도네시아','Indonesia','AS','+62','IDR'],
  ['PH','PHL','필리핀','Philippines','AS','+63','PHP'],
  ['IN','IND','인도','India','AS','+91','INR'],
  ['PK','PAK','파키스탄','Pakistan','AS','+92','PKR'],
  ['NP','NPL','네팔','Nepal','AS','+977','NPR'],
  ['LK','LKA','스리랑카','Sri Lanka','AS','+94','LKR'],
  ['MV','MDV','몰디브','Maldives','AS','+960','MVR'],
  ['BD','BGD','방글라데시','Bangladesh','AS','+880','BDT'],
  ['IR','IRN','이란','Iran','AS','+98','IRR'],
  ['SA','SAU','사우디아라비아','Saudi Arabia','AS','+966','SAR'],
  ['AE','ARE','아랍에미리트','United Arab Emirates','AS','+971','AED'],
  ['QA','QAT','카타르','Qatar','AS','+974','QAR'],
  ['KW','KWT','쿠웨이트','Kuwait','AS','+965','KWD'],
  ['OM','OMN','오만','Oman','AS','+968','OMR'],
  ['IL','ISR','이스라엘','Israel','AS','+972','ILS'],
  ['JO','JOR','요르단','Jordan','AS','+962','JOD'],
  ['TR','TUR','튀르키예','Türkiye','AS','+90','TRY'],
  ['KZ','KAZ','카자흐스탄','Kazakhstan','AS','+7','KZT'],
  ['UZ','UZB','우즈베키스탄','Uzbekistan','AS','+998','UZS'],

  // Europe
  ['GB','GBR','영국','United Kingdom','EU','+44','GBP'],
  ['IE','IRL','아일랜드','Ireland','EU','+353','EUR'],
  ['FR','FRA','프랑스','France','EU','+33','EUR'],
  ['DE','DEU','독일','Germany','EU','+49','EUR'],
  ['IT','ITA','이탈리아','Italy','EU','+39','EUR'],
  ['ES','ESP','스페인','Spain','EU','+34','EUR'],
  ['PT','PRT','포르투갈','Portugal','EU','+351','EUR'],
  ['NL','NLD','네덜란드','Netherlands','EU','+31','EUR'],
  ['BE','BEL','벨기에','Belgium','EU','+32','EUR'],
  ['LU','LUX','룩셈부르크','Luxembourg','EU','+352','EUR'],
  ['CH','CHE','스위스','Switzerland','EU','+41','CHF'],
  ['AT','AUT','오스트리아','Austria','EU','+43','EUR'],
  ['GR','GRC','그리스','Greece','EU','+30','EUR'],
  ['DK','DNK','덴마크','Denmark','EU','+45','DKK'],
  ['SE','SWE','스웨덴','Sweden','EU','+46','SEK'],
  ['NO','NOR','노르웨이','Norway','EU','+47','NOK'],
  ['FI','FIN','핀란드','Finland','EU','+358','EUR'],
  ['IS','ISL','아이슬란드','Iceland','EU','+354','ISK'],
  ['PL','POL','폴란드','Poland','EU','+48','PLN'],
  ['CZ','CZE','체코','Czechia','EU','+420','CZK'],
  ['HU','HUN','헝가리','Hungary','EU','+36','HUF'],
  ['SK','SVK','슬로바키아','Slovakia','EU','+421','EUR'],
  ['RO','ROU','루마니아','Romania','EU','+40','RON'],
  ['BG','BGR','불가리아','Bulgaria','EU','+359','BGN'],
  ['HR','HRV','크로아티아','Croatia','EU','+385','EUR'],
  ['RS','SRB','세르비아','Serbia','EU','+381','RSD'],
  ['RU','RUS','러시아','Russia','EU','+7','RUB'],
  ['UA','UKR','우크라이나','Ukraine','EU','+380','UAH'],
  ['EE','EST','에스토니아','Estonia','EU','+372','EUR'],
  ['LT','LTU','리투아니아','Lithuania','EU','+370','EUR'],
  ['LV','LVA','라트비아','Latvia','EU','+371','EUR'],

  // North America
  ['US','USA','미국','United States','NA','+1','USD'],
  ['CA','CAN','캐나다','Canada','NA','+1','CAD'],
  ['MX','MEX','멕시코','Mexico','NA','+52','MXN'],
  ['CU','CUB','쿠바','Cuba','NA','+53','CUP'],
  ['GT','GTM','과테말라','Guatemala','NA','+502','GTQ'],
  ['CR','CRI','코스타리카','Costa Rica','NA','+506','CRC'],
  ['PA','PAN','파나마','Panama','NA','+507','PAB'],
  ['DO','DOM','도미니카 공화국','Dominican Republic','NA','+1','DOP'],
  ['JM','JAM','자메이카','Jamaica','NA','+1','JMD'],
  ['BS','BHS','바하마','Bahamas','NA','+1','BSD'],

  // South America
  ['BR','BRA','브라질','Brazil','SA','+55','BRL'],
  ['AR','ARG','아르헨티나','Argentina','SA','+54','ARS'],
  ['CL','CHL','칠레','Chile','SA','+56','CLP'],
  ['PE','PER','페루','Peru','SA','+51','PEN'],
  ['CO','COL','콜롬비아','Colombia','SA','+57','COP'],
  ['EC','ECU','에콰도르','Ecuador','SA','+593','USD'],
  ['BO','BOL','볼리비아','Bolivia','SA','+591','BOB'],
  ['UY','URY','우루과이','Uruguay','SA','+598','UYU'],
  ['PY','PRY','파라과이','Paraguay','SA','+595','PYG'],
  ['VE','VEN','베네수엘라','Venezuela','SA','+58','VES'],

  // Oceania
  ['AU','AUS','오스트레일리아','Australia','OC','+61','AUD'],
  ['NZ','NZL','뉴질랜드','New Zealand','OC','+64','NZD'],
  ['FJ','FJI','피지','Fiji','OC','+679','FJD'],
  ['PG','PNG','파푸아뉴기니','Papua New Guinea','OC','+675','PGK'],
  ['WS','WSM','사모아','Samoa','OC','+685','WST'],

  // Africa
  ['ZA','ZAF','남아프리카 공화국','South Africa','AF','+27','ZAR'],
  ['EG','EGY','이집트','Egypt','AF','+20','EGP'],
  ['MA','MAR','모로코','Morocco','AF','+212','MAD'],
  ['TN','TUN','튀니지','Tunisia','AF','+216','TND'],
  ['KE','KEN','케냐','Kenya','AF','+254','KES'],
  ['TZ','TZA','탄자니아','Tanzania','AF','+255','TZS'],
  ['ET','ETH','에티오피아','Ethiopia','AF','+251','ETB'],
  ['NG','NGA','나이지리아','Nigeria','AF','+234','NGN'],
  ['GH','GHA','가나','Ghana','AF','+233','GHS'],
  ['MU','MUS','모리셔스','Mauritius','AF','+230','MUR'],
];

function flagEmoji(code) {
  return [...code.toUpperCase()]
    .map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65))
    .join('');
}

for (const [code, code3, ko, en, continent, calling, currency] of COUNTRIES) {
  await query(
    `INSERT INTO countries (code, code3, name_ko, name_en, flag_emoji, continent_code, calling_code, currency_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       code3 = VALUES(code3),
       name_ko = VALUES(name_ko),
       name_en = VALUES(name_en),
       flag_emoji = VALUES(flag_emoji),
       continent_code = VALUES(continent_code),
       calling_code = VALUES(calling_code),
       currency_code = VALUES(currency_code)`,
    [code, code3, ko, en, flagEmoji(code), continent, calling, currency]
  );
}

const summary = await query(`
  SELECT c.code AS continent, c.name_ko, COUNT(cn.id) AS cnt
  FROM continents c
  LEFT JOIN countries cn ON cn.continent_code = c.code
  GROUP BY c.code, c.name_ko, c.sort_order
  ORDER BY c.sort_order
`);
console.table(summary);

const sample = await query(
  `SELECT code, flag_emoji, name_ko, continent_code, calling_code, currency_code
   FROM countries WHERE code IN ('KR','JP','GR','US','BR','AU','EG') ORDER BY name_ko`
);
console.table(sample);

await pool.end();
