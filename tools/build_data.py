# -*- coding: utf-8 -*-
"""
city-footprint 数据构建脚本
输入: src/assets/geo/raw/ 下的原始 GeoJSON（DataV GeoAtlas 高德数据源 + echarts4 world）
输出:
  src/assets/geo/china.json        全国省级地图（精简属性，含南海诸岛十段线）
  src/assets/geo/city/{adcode}.json 各省城市级地图（台湾由省轮廓生成）
  src/assets/geo/world.json        世界国家级地图（精简属性）
  src/assets/data/destinations.json 目的地清单（中国城市 + 世界国家/热门城市）
"""
import json, os, sys

SRC = r'C:\Users\ZYJ\Documents\Agent 开发\workspace-013\city-footprint\src'
RAW = os.path.join(SRC, 'assets', 'geo', 'raw')
GEO = os.path.join(SRC, 'assets', 'geo')
CITY_DIR = os.path.join(GEO, 'city')
DATA = os.path.join(SRC, 'assets', 'data')
os.makedirs(CITY_DIR, exist_ok=True)
os.makedirs(DATA, exist_ok=True)

def dump(obj, path):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
    print(f'  -> {os.path.basename(path)}  {os.path.getsize(path)//1024} KB')

def slim(f, keep_adcode=True):
    p = f['properties']
    props = {'name': p.get('name', '')}
    if keep_adcode and 'adcode' in p:
        props['adcode'] = p['adcode']
    return {'type': 'Feature', 'properties': props, 'geometry': f['geometry']}

# ---------- 1. 全国省级地图 ----------
print('[1/4] china.json')
china = json.load(open(os.path.join(RAW, 'china_full.json'), encoding='utf-8'))
prov_index = {}
china_feats = []
for f in china['features']:
    p = f['properties']
    name = p.get('name', '')
    if name:
        prov_index[p['adcode']] = name
    china_feats.append(slim(f))
dump({'type': 'FeatureCollection', 'features': china_feats}, os.path.join(GEO, 'china.json'))

PROV_ORDER = [110000, 120000, 130000, 140000, 150000, 210000, 220000, 230000,
              310000, 320000, 330000, 340000, 350000, 360000, 370000, 410000,
              420000, 430000, 440000, 450000, 460000, 500000, 510000, 520000,
              530000, 540000, 610000, 620000, 630000, 640000, 650000, 710000,
              810000, 820000]
SHORT = {110000:'北京',120000:'天津',130000:'河北',140000:'山西',150000:'内蒙古',
         210000:'辽宁',220000:'吉林',230000:'黑龙江',310000:'上海',320000:'江苏',
         330000:'浙江',340000:'安徽',350000:'福建',360000:'江西',370000:'山东',
         410000:'河南',420000:'湖北',430000:'湖南',440000:'广东',450000:'广西',
         460000:'海南',500000:'重庆',510000:'四川',520000:'贵州',530000:'云南',
         540000:'西藏',610000:'陕西',620000:'甘肃',630000:'青海',640000:'宁夏',
         650000:'新疆',710000:'台湾',810000:'香港',820000:'澳门'}
# 整体打卡的省级单位（直辖市/港澳台）：目的地 = 省级本身
WHOLE = {110000, 120000, 310000, 500000, 710000, 810000, 820000}

# ---------- 2. 省级城市地图 + 中国目的地 ----------
print('[2/4] city/*.json + 中国目的地')
dest_china = []
total_cn_cities = 0
for code in PROV_ORDER:
    path = os.path.join(RAW, f'prov_{code}.json')
    feats = None
    if code != 710000 and os.path.exists(path):
        try:
            d = json.load(open(path, encoding='utf-8'))
            feats = [slim(f) for f in d['features'] if f['properties'].get('name')]
        except Exception:
            feats = None
    if feats is None:
        # 台湾（或缺失文件）从全国图提取省轮廓
        feat = next(f for f in china['features'] if f['properties'].get('adcode') == code)
        feats = [slim(feat)]
    dump({'type': 'FeatureCollection', 'features': feats}, os.path.join(CITY_DIR, f'{code}.json'))

    if code in WHOLE:
        cities = [{'id': f'cn_{code}', 'adcode': code, 'name': SHORT[code]}]
    else:
        cities = [{'id': f"cn_{f['properties']['adcode']}",
                   'adcode': f['properties']['adcode'],
                   'name': f['properties']['name']} for f in feats]
    total_cn_cities += len(cities)
    dest_china.append({'adcode': code, 'name': prov_index[code], 'short': SHORT[code], 'cities': cities})

# ---------- 3. 世界地图 ----------
print('[3/4] world.json')
world = json.load(open(os.path.join(RAW, 'world_raw.json'), encoding='utf-8'))
world_feats = [{'type': 'Feature', 'properties': {'name': f['properties'].get('name', '')},
                'geometry': f['geometry']} for f in world['features']]
dump({'type': 'FeatureCollection', 'features': world_feats}, os.path.join(GEO, 'world.json'))
world_names = [f['properties']['name'] for f in world_feats if f['properties']['name']]

# ---------- 4. 世界目的地 ----------
print('[4/4] destinations.json')
COUNTRY_CN = {
 'China':'中国','Japan':'日本','Korea':'韩国','Dem. Rep. Korea':'朝鲜','Mongolia':'蒙古',
 'Thailand':'泰国','Singapore':'新加坡','Malaysia':'马来西亚','Indonesia':'印度尼西亚',
 'Vietnam':'越南','Philippines':'菲律宾','Cambodia':'柬埔寨','Myanmar':'缅甸','Lao PDR':'老挝',
 'Brunei':'文莱','India':'印度','Nepal':'尼泊尔','Sri Lanka':'斯里兰卡','Maldives':'马尔代夫',
 'Pakistan':'巴基斯坦','Bangladesh':'孟加拉国','Bhutan':'不丹','Afghanistan':'阿富汗',
 'Kazakhstan':'哈萨克斯坦','Uzbekistan':'乌兹别克斯坦','Kyrgyzstan':'吉尔吉斯斯坦',
 'Tajikistan':'塔吉克斯坦','Turkmenistan':'土库曼斯坦','Russia':'俄罗斯',
 'United Arab Emirates':'阿联酋','Qatar':'卡塔尔','Saudi Arabia':'沙特阿拉伯','Turkey':'土耳其',
 'Israel':'以色列','Jordan':'约旦','Iran':'伊朗','Iraq':'伊拉克','Kuwait':'科威特','Oman':'阿曼',
 'Yemen':'也门','Syria':'叙利亚','Lebanon':'黎巴嫩','Palestine':'巴勒斯坦','Georgia':'格鲁吉亚',
 'Armenia':'亚美尼亚','Azerbaijan':'阿塞拜疆','Cyprus':'塞浦路斯',
 'United Kingdom':'英国','Ireland':'爱尔兰','France':'法国','Germany':'德国','Italy':'意大利',
 'Spain':'西班牙','Portugal':'葡萄牙','Netherlands':'荷兰','Belgium':'比利时','Luxembourg':'卢森堡',
 'Switzerland':'瑞士','Austria':'奥地利','Greece':'希腊','Czech Rep.':'捷克','Slovakia':'斯洛伐克',
 'Hungary':'匈牙利','Poland':'波兰','Sweden':'瑞典','Norway':'挪威','Finland':'芬兰',
 'Denmark':'丹麦','Iceland':'冰岛','Estonia':'爱沙尼亚','Latvia':'拉脱维亚','Lithuania':'立陶宛',
 'Belarus':'白俄罗斯','Ukraine':'乌克兰','Romania':'罗马尼亚','Bulgaria':'保加利亚',
 'Serbia':'塞尔维亚','Croatia':'克罗地亚','Slovenia':'斯洛文尼亚','Bosnia and Herz.':'波黑',
 'Montenegro':'黑山','Macedonia':'北马其顿','Albania':'阿尔巴尼亚','Malta':'马耳他',
 'Egypt':'埃及','Morocco':'摩洛哥','South Africa':'南非','Kenya':'肯尼亚','Tanzania':'坦桑尼亚',
 'Ethiopia':'埃塞俄比亚','Tunisia':'突尼斯','Mauritius':'毛里求斯','Seychelles':'塞舌尔',
 'Madagascar':'马达加斯加','United States':'美国','Canada':'加拿大','Mexico':'墨西哥',
 'Cuba':'古巴','Brazil':'巴西','Argentina':'阿根廷','Peru':'秘鲁','Chile':'智利',
 'Colombia':'哥伦比亚','Venezuela':'委内瑞拉','Ecuador':'厄瓜多尔','Bolivia':'玻利维亚',
 'Uruguay':'乌拉圭','Australia':'澳大利亚','New Zealand':'新西兰','Fiji':'斐济',
 'Papua New Guinea':'巴布亚新几内亚','Samoa':'萨摩亚','Vanuatu':'瓦努阿图',
}
# 热门国际城市（按世界图英文名归组）
INTL_CITIES = {
 'Japan':['东京','大阪','京都','札幌','冲绳'],
 'Korea':['首尔','釜山','济州岛'],
 'Mongolia':['乌兰巴托'],
 'Thailand':['曼谷','清迈','普吉岛'],
 'Singapore':['新加坡市'],
 'Malaysia':['吉隆坡','槟城','兰卡威'],
 'Indonesia':['巴厘岛','雅加达'],
 'Vietnam':['河内','胡志明市','岘港'],
 'Philippines':['马尼拉','长滩岛','宿务'],
 'Cambodia':['暹粒','金边'],
 'Myanmar':['仰光','蒲甘'],
 'Lao PDR':['万象','琅勃拉邦'],
 'India':['新德里','孟买','斋浦尔'],
 'Nepal':['加德满都'],
 'Sri Lanka':['科伦坡'],
 'Maldives':['马累'],
 'United Arab Emirates':['迪拜','阿布扎比'],
 'Qatar':['多哈'],
 'Turkey':['伊斯坦布尔','卡帕多奇亚'],
 'Russia':['莫斯科','圣彼得堡','海参崴'],
 'Kazakhstan':['阿拉木图'],
 'Israel':['耶路撒冷','特拉维夫'],
 'United Kingdom':['伦敦','爱丁堡','曼彻斯特'],
 'Ireland':['都柏林'],
 'France':['巴黎','尼斯','里昂'],
 'Germany':['柏林','慕尼黑','法兰克福'],
 'Italy':['罗马','威尼斯','佛罗伦萨','米兰'],
 'Spain':['马德里','巴塞罗那','塞维利亚'],
 'Portugal':['里斯本','波尔图'],
 'Netherlands':['阿姆斯特丹'],
 'Belgium':['布鲁塞尔','布鲁日'],
 'Switzerland':['苏黎世','日内瓦','因特拉肯'],
 'Austria':['维也纳','萨尔茨堡'],
 'Greece':['雅典','圣托里尼'],
 'Czech Rep.':['布拉格'],
 'Hungary':['布达佩斯'],
 'Poland':['华沙','克拉科夫'],
 'Sweden':['斯德哥尔摩'],
 'Norway':['奥斯陆','卑尔根'],
 'Finland':['赫尔辛基'],
 'Denmark':['哥本哈根'],
 'Iceland':['雷克雅未克'],
 'Croatia':['杜布罗夫尼克','萨格勒布'],
 'Egypt':['开罗','卢克索'],
 'Morocco':['卡萨布兰卡','马拉喀什'],
 'South Africa':['开普敦','约翰内斯堡'],
 'Kenya':['内罗毕'],
 'Tanzania':['达累斯萨拉姆','桑给巴尔'],
 'United States':['纽约','洛杉矶','旧金山','拉斯维加斯','西雅图','波士顿','华盛顿','芝加哥','檀香山','迈阿密'],
 'Canada':['多伦多','温哥华','蒙特利尔'],
 'Mexico':['墨西哥城','坎昆'],
 'Cuba':['哈瓦那'],
 'Brazil':['里约热内卢','圣保罗'],
 'Argentina':['布宜诺斯艾利斯'],
 'Peru':['利马','库斯科'],
 'Chile':['圣地亚哥'],
 'Australia':['悉尼','墨尔本','黄金海岸','凯恩斯'],
 'New Zealand':['奥克兰','皇后镇'],
 'Fiji':['楠迪'],
}
dest_world = []
for en in sorted(world_names, key=lambda x: COUNTRY_CN.get(x, x)):
    cn = COUNTRY_CN.get(en)
    if cn is None:
        continue  # 无中文名的冷门地区不列入清单（仍显示在世界地图上）
    cities = [{'id': f'intl_{en}_{i}', 'name': c} for i, c in enumerate(INTL_CITIES.get(en, []))]
    cities.append({'id': f'intl_{en}_other', 'name': f'{cn}（其他地方）'})
    dest_world.append({'en': en, 'cn': cn, 'cities': cities})

dest = {'china': dest_china, 'world': dest_world,
        'stats': {'cnProvinces': len(dest_china), 'cnCities': total_cn_cities,
                  'countries': len(dest_world)}}
dump(dest, os.path.join(DATA, 'destinations.json'))
print(f"完成：中国 {len(dest_china)} 省 / {total_cn_cities} 城，世界 {len(dest_world)} 国")
