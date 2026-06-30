/**
 * 2026週年慶紀念品－吊飾｜登記購買系統 後端
 * Google Apps Script Web App（doGet + JSONP）
 *
 * 部署：部署 → 新增部署 → 類型「網頁應用程式」
 *       執行身分：我 / 存取權：任何人 → 複製 /exec 網址貼到 index.html 的 GOOGLE_SCRIPT_URL
 *
 * 第一次使用：開試算表 → 重新整理 → 上方選單「紀念品系統 → 初始化／重建工作表」
 * 改過本檔後：要重新部署（管理部署作業 → 編輯 → 版本選「新版本」），網址才不會變。
 */

/* ====================== 工作表名稱與欄位 ====================== */
var SHEET_SETTINGS = '系統設定';
var SHEET_PRODUCTS = '商品設定';
var SHEET_RECORDS  = '登記資料';
var SHEET_STATS    = '統計';
var SHEET_MAIL     = '郵寄清單';
var SHEET_EARLY    = '提早領清單';
var SHEET_SAMEDAY  = '當天領清單';

// 登記資料欄位順序（用「位置」讀寫，新增欄位請放最後）
// 單一商品設計：不需商品2、不需小計
var REC_HEADERS = [
  '建立時間', '姓名',
  '商品名稱', '單價', '數量',
  '商品總金額', '取貨方式', '郵寄費', '總金額',
  '收件人', '收件人電話', '配送方式',
  '超商名稱', '門市名稱', '門市地址', '郵遞區號', '完整收件地址',
  '付款狀態', '取件／寄送狀態', '管理備註', '是否取消', '備註', '代領家人'
];

var PRD_HEADERS = [
  '商品ID', '商品名稱', '商品說明', '單價',
  '圖片連結1', '圖片連結2', '是否顯示', '顯示順序',
  '是否可購買', '數量上限', '備註'
];

var PAY_STATUS  = ['未付款', '已付款', '不需付款', '已退款'];
var SHIP_STATUS = ['未處理', '待取件', '已取件', '待寄出', '已寄出', '已完成'];

/* 常見姓氏筆畫表（依姓氏第一字筆畫排序用；表內沒有的姓氏會排到最後）。
 * 若有姓氏排序不對，找到該姓氏、移到正確的筆畫那一行即可。 */
var SURNAME_STROKES_RAW = {
  2: '丁卜力刀',
  3: '于山干弓大子千',
  4: '王方尤毛文孔牛尹巴戈卞仇元公仁木水井天太夫化',
  5: '古田白包史申平甘皮石丘司左冉玉召丙卯民永由甲付令北布弘充可玄句',
  6: '朱江池全安任伊仲向后吉年朴自艾伍牟米危列匡成羊多伏戎圭老西印旭守',
  7: '何余吳宋巫谷利李杜沈車辛邢貝步呂岑沙甫良言阮杞冷汪束吾杉但佐杏邑廷那',
  8: '林周房易卓金孟武來季屈宗居幸岳服杭松杯卷和庚沛狄竺邵牧昌官宓汲杰欣沃知念',
  9: '柯段侯俞姚紀柳韋查封施范紅軍風姜宣帥計柏拜咸姬胡哈禹後柴泉星昭度飛郁郎洪',
  10: '徐殷翁馬高唐夏孫秦班凌桂桑袁倪涂奚烏祝耿容宮留員師庫索桓時晏哲倉修哥真軒益泰晉桐家宰海',
  11: '張許梁章崔常國麥苗康寇婁區苑商巢寅寄從連梅紹習屠浦苻強庸偉健雪盛',
  12: '黃馮程童賀喬雲鈕費焦舒曾游彭傅富智邰善邱雅開閔堯項越喻嵇須雄萊凱淳賁馭',
  13: '楊詹雷賈廉解湯雍路楚鄒溫莊葉萬虞經裘馳楓詩揚督雋',
  14: '趙廖管翟熊蓋端齊裴甄賓寧壽華臺滕慎福韶菊郜',
  15: '劉蔡鄭歐黎練諸厲樊慶樂鄧樓廣蔣萱樑醇範潘葛',
  16: '賴蕭盧錢駱龍諶穆蒲衛鮑燕蒙默蓬篤蒼樹橋機諾學',
  17: '謝韓鍾戴應繆鴻矯璜賽蕾績駿臨薛隆陽',
  18: '顏簡聶魏瞿闕鄢鄞雙豐璧鎮顓',
  19: '羅龐譚關薄薇譙麗韜璽邊麒鵬',
  20: '嚴藍鐘釋蘇黨寶競馨闞籍',
  21: '顧鐵饒巍譽蘭鶴瓏',
  22: '龔鄺權蘆藺',
  23: '欒顯'
};
var STROKE_MAP = (function () {
  var m = {};
  Object.keys(SURNAME_STROKES_RAW).forEach(function (k) {
    SURNAME_STROKES_RAW[k].split('').forEach(function (ch) { m[ch] = Number(k); });
  });
  return m;
})();

// 取姓氏（第一個字）的筆畫；查不到回 99（排最後）
function surnameStrokes_(name) {
  var s = String(name == null ? '' : name).trim();
  if (!s) return 999;
  var v = STROKE_MAP[s.charAt(0)];
  return v ? v : 99;
}

// 依「姓氏筆畫少→多」排序的比較器；col = 姓名在陣列中的索引
function strokeComparator_(col) {
  return function (a, b) {
    var sa = surnameStrokes_(a[col]), sb = surnameStrokes_(b[col]);
    if (sa !== sb) return sa - sb;
    var na = String(a[col]), nb = String(b[col]);
    return na < nb ? -1 : (na > nb ? 1 : 0);
  };
}

/* ====================== Web App 入口（JSONP） ====================== */
function doGet(e) {
  var cb = (e && e.parameter && e.parameter.callback) ? e.parameter.callback : 'callback';
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : '';
  var out;
  try {
    if (action === 'status')      out = handleStatus_();
    else if (action === 'submit') out = handleSubmit_(e.parameter.data);
    else if (action === 'query')  out = handleQuery_(e.parameter.name);
    else                          out = { ok: false, error: '未知的請求' };
  } catch (err) {
    out = { ok: false, error: '系統忙碌中，請稍後再試。(' + err + ')' };
  }
  return ContentService
    .createTextOutput(cb + '(' + JSON.stringify(out) + ')')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

// 也允許 POST（保留彈性，內部走同一套）
function doPost(e) {
  return doGet(e);
}

/* ====================== status：回傳設定 + 商品 ====================== */
function handleStatus_() {
  var s = getSettingsMap_();
  var open = isRegistrationOpen_(s);

  return {
    ok: true,
    open: open.open,
    closedReason: open.reason,
    settings: {
      systemTitle:   s['系統標題']   || '2026週年慶紀念品－吊飾',
      activityName:  s['活動名稱']   || '2026週年慶紀念品－吊飾',
      activityDate:  s['活動日期']   || '',
      announcement:  s['公告文字']   || '',
      successText:   s['成功頁提示文字'] || '取件或寄送時間將另行通知。',
      mailFee:       toNumber_(s['郵寄費'], 100),
      pickup: {
        event:    isYes_(s['週年慶當日取件是否開放'], true),
        kaohsiung:isYes_(s['高雄道場提前取件是否開放'], true),
        mail:     isYes_(s['郵寄是否開放'], true)
      }
    },
    products: getProducts_()
  };
}

function isRegistrationOpen_(s) {
  if (!isYes_(s['是否開放登記'], true)) {
    return { open: false, reason: s['公告文字'] || '目前未開放登記。' };
  }
  var deadline = s['登記截止時間'];
  if (deadline) {
    var d = (deadline instanceof Date) ? deadline : new Date(deadline);
    if (!isNaN(d.getTime()) && new Date().getTime() > d.getTime()) {
      return { open: false, reason: '登記已於 ' + formatDateTime_(d) + ' 截止。' };
    }
  }
  return { open: true, reason: '' };
}

/* ====================== submit：寫入一筆登記 ====================== */
function handleSubmit_(dataStr) {
  if (!dataStr) return { ok: false, error: '沒有收到資料。' };
  var data;
  try { data = JSON.parse(dataStr); }
  catch (e) { return { ok: false, error: '資料格式錯誤。' }; }

  var s = getSettingsMap_();
  var open = isRegistrationOpen_(s);
  if (!open.open) return { ok: false, error: open.reason || '目前未開放登記。' };

  // --- 姓名 ---
  var name = cleanText_(data.name);
  if (!name) return { ok: false, error: '請填寫姓名。' };

  // --- 商品（後端依商品設定重新計價，不信前端金額）---
  var products = getProducts_();
  var prdMap = {};
  products.forEach(function (p) { prdMap[p.id] = p; });

  var reqItems = (data.items && data.items.length) ? data.items : [];
  var chosen = [];          // 實際購買（qty>0）
  var productTotal = 0;
  reqItems.forEach(function (it) {
    var p = prdMap[String(it.id)];
    if (!p || !p.canBuy) return;
    var qty = Math.floor(toNumber_(it.qty, 0));
    if (qty < 0) qty = 0;
    if (p.maxQty > 0 && qty > p.maxQty) qty = p.maxQty;
    if (qty <= 0) return;
    var subtotal = p.price * qty;
    productTotal += subtotal;
    chosen.push({ id: p.id, name: p.name, price: p.price, qty: qty, subtotal: subtotal });
  });
  if (chosen.length === 0) return { ok: false, error: '請至少選購一件商品。' };

  // --- 取貨方式 ---
  var pickupRaw = String(data.pickup || '');
  var pickupLabelMap = { event: '週年慶當日取件', kaohsiung: '提早至高雄道場取件', mail: '郵寄' };
  var pickupLabel = pickupLabelMap[pickupRaw];
  if (!pickupLabel) return { ok: false, error: '請選擇取貨方式。' };
  var pickupOpen = { event: isYes_(s['週年慶當日取件是否開放'], true),
                     kaohsiung: isYes_(s['高雄道場提前取件是否開放'], true),
                     mail: isYes_(s['郵寄是否開放'], true) };
  if (!pickupOpen[pickupRaw]) return { ok: false, error: '此取貨方式目前未開放。' };

  // --- 郵寄欄位 ---
  var mailFee = 0;
  var recipient = '', phone = '', deliveryType = '';
  var cvsName = '', storeName = '', storeAddr = '', zip = '', address = '';

  if (pickupRaw === 'mail') {
    mailFee = toNumber_(s['郵寄費'], 100);
    recipient = cleanText_(data.recipient);
    phone     = cleanText_(data.phone);
    if (!recipient) return { ok: false, error: '請填寫收件人。' };
    if (!phone)     return { ok: false, error: '請填寫收件人電話。' };
    if (!isPhoneLoose_(phone)) return { ok: false, error: '收件人電話格式看起來怪怪的，請再確認。' };

    var dt = String(data.deliveryType || '');
    if (dt === 'cvs') {
      deliveryType = '超商店到店';
      cvsName   = cleanText_(data.cvsName);
      storeName = cleanText_(data.storeName);
      storeAddr = cleanText_(data.storeAddr);   // 選填
      if (!cvsName)   return { ok: false, error: '請選擇超商名稱。' };
      if (!storeName) return { ok: false, error: '請填寫門市名稱。' };
    } else if (dt === 'home') {
      deliveryType = '宅配地址';
      address = cleanText_(data.address);
      zip     = cleanText_(data.zip);           // 選填
      if (!address) return { ok: false, error: '請填寫完整收件地址。' };
    } else {
      return { ok: false, error: '請選擇配送方式。' };
    }
  }

  var grandTotal = productTotal + mailFee;

  // --- 備註（登記人留言，選填）---
  var note = cleanText_(data.note);

  // --- 寫入（鎖 + 批次）---
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); }
  catch (e) { return { ok: false, error: '系統忙碌中，請稍後再試。' }; }

  try {
    var sh = getSheet_(SHEET_RECORDS);

    // 單一商品：記錄實際購買的商品名稱／單價／數量
    var buy = chosen[0];

    var row = [
      new Date(), name,
      buy.name, buy.price, buy.qty,
      productTotal, pickupLabel, mailFee, grandTotal,
      recipient, phone, deliveryType,
      cvsName, storeName, storeAddr, zip, address,
      '未付款', '未處理', '', '', note, ''  // 最後一欄「代領家人」：留空，由管理者手動填
    ];
    sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  // 回傳成功摘要（給成功頁顯示）
  return {
    ok: true,
    summary: {
      name: name,
      items: chosen,
      productTotal: productTotal,
      pickup: pickupLabel,
      mailFee: mailFee,
      grandTotal: grandTotal,
      successText: s['成功頁提示文字'] || '取件或寄送時間將另行通知。'
    }
  };
}

/* ====================== query：依姓名查詢登記 ====================== */
function handleQuery_(nameParam) {
  var name = (nameParam == null) ? '' : String(nameParam).trim();
  if (!name) return { ok: false, error: '請輸入姓名。' };

  var tz = Session.getScriptTimeZone() || 'Asia/Taipei';

  var out = [];
  var sh = getSheet_(SHEET_RECORDS);
  var last = sh.getLastRow();
  if (last >= 2) {
    var vals = sh.getRange(2, 1, last - 1, REC_HEADERS.length).getValues();
    var idx = {};
    REC_HEADERS.forEach(function (h, i) { idx[h] = i; });
    vals.forEach(function (r) {
      var nm = String(r[idx['姓名']] || '').trim();
      if (nm !== name) return;
      if (String(r[idx['是否取消']] || '').trim() === '是') return; // 已取消不顯示
      var t = r[idx['建立時間']];
      out.push({
        time:        (t instanceof Date) ? Utilities.formatDate(t, tz, 'yyyy/MM/dd HH:mm') : String(t || ''),
        name:        nm,
        productName: r[idx['商品名稱']],
        price:       r[idx['單價']],
        qty:         r[idx['數量']],
        productTotal:r[idx['商品總金額']],
        pickup:      r[idx['取貨方式']],
        mailFee:     r[idx['郵寄費']],
        grandTotal:  r[idx['總金額']],
        payStatus:   r[idx['付款狀態']],
        shipStatus:  r[idx['取件／寄送狀態']],
        note:        r[idx['備註']],
        proxy:       String(r[idx['代領家人']] || '').trim()  // 管理者手填的代領家人
      });
    });
  }

  return { ok: true, records: out };
}

/* ====================== 讀取設定 / 商品 ====================== */
function getSettingsMap_() {
  var sh = getSheet_(SHEET_SETTINGS);
  var map = {};
  var last = sh.getLastRow();
  if (last < 2) return map;
  var vals = sh.getRange(2, 1, last - 1, 2).getValues();
  vals.forEach(function (r) {
    var k = String(r[0]).trim();
    if (k) map[k] = (r[1] === null || r[1] === undefined) ? '' : r[1];
  });
  return map;
}

function getProducts_() {
  var sh = getSheet_(SHEET_PRODUCTS);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, PRD_HEADERS.length).getValues();
  var list = [];
  vals.forEach(function (r) {
    var id = String(r[0]).trim();
    if (!id) return;
    if (!isYes_(r[6], false)) return;  // 是否顯示
    var imgs = [];
    var u1 = convertDriveUrl_(r[4]); if (u1) imgs.push(u1);
    var u2 = convertDriveUrl_(r[5]); if (u2) imgs.push(u2);
    list.push({
      id: id,
      name: String(r[1] || '').trim(),
      desc: String(r[2] || '').trim(),
      price: toNumber_(r[3], 0),
      images: imgs,
      canBuy: isYes_(r[8], true),     // 是否可購買
      maxQty: Math.floor(toNumber_(r[9], 99))
    });
  });
  // 依「顯示順序」排序
  var withOrder = [];
  vals.forEach(function (r) {
    var id = String(r[0]).trim();
    if (!id || !isYes_(r[6], false)) return;
    withOrder.push({ id: id, order: toNumber_(r[7], 999) });
  });
  list.sort(function (a, b) {
    function ord(id) { for (var i = 0; i < withOrder.length; i++) if (withOrder[i].id === id) return withOrder[i].order; return 999; }
    return ord(a.id) - ord(b.id);
  });
  return list;
}

/* ====================== 工具函式 ====================== */
function getSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function toNumber_(v, dflt) {
  if (v === null || v === undefined || v === '') return dflt;
  var n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? dflt : n;
}

function isYes_(v, dflt) {
  if (v === null || v === undefined || v === '') return dflt;
  var t = String(v).trim().toLowerCase();
  if (['是', '開放', 'y', 'yes', 'true', '1', 'on', '可'].indexOf(t) >= 0) return true;
  if (['否', '關閉', 'n', 'no', 'false', '0', 'off', '不'].indexOf(t) >= 0) return false;
  return dflt;
}

function isPhoneLoose_(p) {
  var digits = String(p).replace(/[^0-9]/g, '');
  return digits.length >= 8 && digits.length <= 15;  // 寬鬆檢查，不過度限制
}

// 清理文字，避免公式注入（= + - @ 開頭加上單引號）
function cleanText_(v) {
  if (v === null || v === undefined) return '';
  var s = String(v).trim();
  if (s === '') return '';
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

// 將 Google Drive 分享連結轉成可直接顯示的圖片網址
function convertDriveUrl_(raw) {
  if (!raw) return '';
  var s = String(raw).trim();
  if (!s) return '';
  var id = '';
  var m;
  if ((m = s.match(/\/file\/d\/([a-zA-Z0-9_\-]+)/)))      id = m[1];
  else if ((m = s.match(/[?&]id=([a-zA-Z0-9_\-]+)/)))     id = m[1];
  else if ((m = s.match(/\/d\/([a-zA-Z0-9_\-]+)/)))       id = m[1];
  if (id) return 'https://drive.google.com/thumbnail?id=' + id + '&sz=w1200';
  return s; // 已是直接網址就原樣回傳
}

function formatDateTime_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone() || 'Asia/Taipei', 'yyyy/MM/dd HH:mm');
}

/* ====================== 選單 / 初始化 ====================== */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('紀念品系統')
    .addItem('初始化（只建立缺少的工作表）', 'setupSheet')
    .addSeparator()
    .addItem('產生 列印清單（郵寄／提早／當天）', 'buildAllPrintLists')
    .addItem('重建 統計頁', 'buildStats_')
    .addItem('重算所有金額', 'recalcAllAmounts')
    .addItem('標記重複姓名（紅底）', 'highlightDuplicates')
    .addSeparator()
    .addItem('重建 登記資料表（會清空登記）', 'rebuildRecords')
    .addToUi();
}

/* ====================== 重複姓名標記（條件式格式，自動套用） ====================== */
// 選單：對現有「登記資料」套用「姓名重複→紅底」（不會動到資料）
function highlightDuplicates() {
  applyDuplicateHighlight_(getSheet_(SHEET_RECORDS));
  try { SpreadsheetApp.getActiveSpreadsheet().toast('已設定：姓名重複會自動標紅底。', '紀念品系統', 4); } catch (e) {}
}

function applyDuplicateHighlight_(sh) {
  var nameCol = REC_HEADERS.indexOf('姓名') + 1;
  var L = colLetter_(nameCol);
  var maxRows = Math.max(sh.getMaxRows() - 1, 1);
  var range = sh.getRange(2, nameCol, maxRows, 1);
  // 該姓名在整欄出現超過 1 次就上色
  var formula = '=AND($' + L + '2<>"", COUNTIF($' + L + ':$' + L + ',$' + L + '2)>1)';
  var rule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(formula)
    .setBackground('#f4c7c3')   // 淺紅底
    .setRanges([range])
    .build();

  // 移除我們先前加的同色規則，避免重複堆疊；其他規則保留
  var kept = sh.getConditionalFormatRules().filter(function (r) {
    try {
      var bc = r.getBooleanCondition();
      return !bc || bc.getBackground() !== '#f4c7c3';
    } catch (e) { return true; }
  });
  kept.push(rule);
  sh.setConditionalFormatRules(kept);
}

/* ====================== 自動重算金額 ======================
 * 在「登記資料」手動改「單價／數量／郵寄費」後，
 * 同一列的「商品總金額」「總金額」自動重算；統計頁是公式加總會跟著更新。
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    if (sh.getName() !== SHEET_RECORDS) return;

    var cPrice = REC_HEADERS.indexOf('單價') + 1;
    var cQty   = REC_HEADERS.indexOf('數量') + 1;
    var cFee   = REC_HEADERS.indexOf('郵寄費') + 1;

    var c1 = e.range.getColumn();
    var c2 = e.range.getLastColumn();
    var touched = (cPrice >= c1 && cPrice <= c2) ||
                  (cQty   >= c1 && cQty   <= c2) ||
                  (cFee   >= c1 && cFee   <= c2);
    if (!touched) return;

    var r1 = Math.max(e.range.getRow(), 2);
    var r2 = e.range.getLastRow();
    for (var r = r1; r <= r2; r++) recalcRecordRow_(sh, r);
  } catch (err) { /* 靜默，避免干擾編輯 */ }
}

function recalcRecordRow_(sh, row) {
  var cPrice = REC_HEADERS.indexOf('單價') + 1;
  var cQty   = REC_HEADERS.indexOf('數量') + 1;
  var cProd  = REC_HEADERS.indexOf('商品總金額') + 1;
  var cFee   = REC_HEADERS.indexOf('郵寄費') + 1;
  var cGrand = REC_HEADERS.indexOf('總金額') + 1;

  var price = Number(sh.getRange(row, cPrice).getValue()) || 0;
  var qty   = Number(sh.getRange(row, cQty).getValue()) || 0;
  var fee   = Number(sh.getRange(row, cFee).getValue()) || 0;
  var prod  = price * qty;
  sh.getRange(row, cProd).setValue(prod);
  sh.getRange(row, cGrand).setValue(prod + fee);
}

// 選單：一次重算整張「登記資料」的金額（大量修改後可手動跑一次）
function recalcAllAmounts() {
  var sh = getSheet_(SHEET_RECORDS);
  var last = sh.getLastRow();
  for (var r = 2; r <= last; r++) recalcRecordRow_(sh, r);
  try { SpreadsheetApp.getActiveSpreadsheet().toast('已重算所有金額。', '紀念品系統', 4); } catch (e) {}
}

/* ====================== 郵寄清單（一鍵整理需郵寄的人） ====================== */
function buildMailingList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rec = ss.getSheetByName(SHEET_RECORDS);
  var sh = ss.getSheetByName(SHEET_MAIL);
  if (!sh) sh = ss.insertSheet(SHEET_MAIL);
  sh.clear();

  var headers = ['登記時間', '姓名', '收件人', '收件人電話', '配送方式',
                 '寄送地址 / 門市', '額外購買', '代領家人', '合計件數', '付款狀態', '寄送狀態'];
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);

  var out = [];
  var last = rec ? rec.getLastRow() : 0;
  if (last >= 2) {
    var vals = rec.getRange(2, 1, last - 1, REC_HEADERS.length).getValues();
    var idx = {};
    REC_HEADERS.forEach(function (h, i) { idx[h] = i; });
    var tz = Session.getScriptTimeZone() || 'Asia/Taipei';

    vals.forEach(function (r) {
      if (String(r[idx['取貨方式']] || '').trim() !== '郵寄') return;
      if (String(r[idx['是否取消']] || '').trim() === '是') return;

      var deliv = String(r[idx['配送方式']] || '').trim();
      var addr;
      if (deliv === '超商店到店') {
        addr = [r[idx['超商名稱']], r[idx['門市名稱']], r[idx['門市地址']]]
          .filter(function (x) { return String(x).trim(); }).join('　');
      } else {
        addr = [r[idx['郵遞區號']], r[idx['完整收件地址']]]
          .filter(function (x) { return String(x).trim(); }).join('　');
      }

      var qty = toNumber_(r[idx['數量']], 0);
      var proxy = String(r[idx['代領家人']] || '').trim();
      var proxyCount = proxy ? proxy.split(/[、,，;；\s]+/).filter(function (x) { return x.trim(); }).length : 0;

      var t = r[idx['建立時間']];
      out.push([
        (t instanceof Date) ? Utilities.formatDate(t, tz, 'yyyy/MM/dd HH:mm') : String(t || ''),
        r[idx['姓名']], r[idx['收件人']], r[idx['收件人電話']], deliv, addr,
        qty, proxy, qty + proxyCount,
        r[idx['付款狀態']], r[idx['取件／寄送狀態']]
      ]);
    });
  }

  out.sort(strokeComparator_(1)); // 依姓氏筆畫少→多（姓名在第 2 欄）

  if (out.length) {
    sh.getRange(2, 1, out.length, headers.length).setValues(out);
    var totalRow = out.length + 2;
    sh.getRange(totalRow, 1).setValue('合計');
    sh.getRange(totalRow, 7).setValue(out.reduce(function (a, b) { return a + (Number(b[6]) || 0); }, 0)); // 額外購買
    sh.getRange(totalRow, 9).setValue(out.reduce(function (a, b) { return a + (Number(b[8]) || 0); }, 0)); // 合計件數
    sh.getRange(totalRow, 1, 1, headers.length).setFontWeight('bold').setBackground('#fff2d6');
  }

  sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#fde7c2');
  sh.setFrozenRows(1);
  sh.setColumnWidth(2, 120); sh.setColumnWidth(3, 120); sh.setColumnWidth(4, 130);
  sh.setColumnWidth(6, 320); sh.setColumnWidth(8, 200);

  try {
    ss.toast('郵寄清單已產生（共 ' + out.length + ' 筆需郵寄）。', '紀念品系統', 5);
  } catch (e) {}
}

/* ====================== 取件清單（提早領 / 當天領，紙本列印用） ====================== */
// 欄位：姓名 / 數量 / 總金額 / 已收 / 已給（已收、已給留空給你紙上打勾）；字體 20；依姓氏筆畫排序
function buildPickupList_(sheetName, pickupLabel) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rec = ss.getSheetByName(SHEET_RECORDS);
  var sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);
  sh.clear();

  var headers = ['姓名', '數量', '總金額', '已收', '已給'];
  var rows = [];
  var last = rec ? rec.getLastRow() : 0;
  if (last >= 2) {
    var vals = rec.getRange(2, 1, last - 1, REC_HEADERS.length).getValues();
    var idx = {};
    REC_HEADERS.forEach(function (h, i) { idx[h] = i; });
    vals.forEach(function (r) {
      if (String(r[idx['取貨方式']] || '').trim() !== pickupLabel) return;
      if (String(r[idx['是否取消']] || '').trim() === '是') return;
      rows.push([r[idx['姓名']], toNumber_(r[idx['數量']], 0), toNumber_(r[idx['總金額']], 0), '', '']);
    });
  }
  rows.sort(strokeComparator_(0)); // 姓名在第 1 欄

  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows);

  var bodyRows = rows.length + 1;            // 含表頭
  // 合計列
  if (rows.length) {
    var tr = rows.length + 2;
    sh.getRange(tr, 1).setValue('合計');
    sh.getRange(tr, 2).setValue(rows.reduce(function (a, b) { return a + (Number(b[1]) || 0); }, 0));
    sh.getRange(tr, 3).setValue(rows.reduce(function (a, b) { return a + (Number(b[2]) || 0); }, 0));
    bodyRows = tr;
  }

  // 字體 20、列高、欄寬、表頭
  sh.getRange(1, 1, bodyRows, headers.length).setFontSize(20).setVerticalAlignment('middle');
  sh.setRowHeights(1, bodyRows, 40);
  sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#fde7c2');
  if (rows.length) sh.getRange(rows.length + 2, 1, 1, headers.length).setFontWeight('bold').setBackground('#fff2d6');
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 200); sh.setColumnWidth(2, 110);
  sh.setColumnWidth(3, 150); sh.setColumnWidth(4, 110); sh.setColumnWidth(5, 110);

  return rows.length;
}

// 選單：產生「提早領」「當天領」兩張清單
function buildPickupLists() {
  var n1 = buildPickupList_(SHEET_EARLY, '提早至高雄道場取件');
  var n2 = buildPickupList_(SHEET_SAMEDAY, '週年慶當日取件');
  try {
    SpreadsheetApp.getActiveSpreadsheet()
      .toast('提早領 ' + n1 + ' 筆、當天領 ' + n2 + ' 筆，已產生。', '紀念品系統', 5);
  } catch (e) {}
}

// 選單：一次產生三種列印清單（郵寄 / 提早領 / 當天領），皆依姓氏筆畫排序
function buildAllPrintLists() {
  buildMailingList();
  buildPickupLists();
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('三種列印清單已全部更新。', '紀念品系統', 5);
  } catch (e) {}
}

/**
 * 非破壞式初始化：
 * - 系統設定 / 商品設定：只有「不存在」時才建立並填預設值，已存在則完全不動（不覆蓋你填的內容）。
 * - 登記資料：欄位結構不符時才重建（會先確認）。
 * - 統計：每次都安全重建（純公式，無資料）。
 */
function setupSheet() {
  setupSettings_();
  setupProducts_();
  setupRecords_(false);
  buildStats_();
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('工作表已就緒（已存在的設定不會被覆蓋）。', '紀念品系統', 5);
  } catch (e) {}
}

function setupSettings_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(SHEET_SETTINGS)) return; // 已存在就不動，避免覆蓋管理者設定
  var sh = ss.insertSheet(SHEET_SETTINGS);
  sh.getRange(1, 1, 1, 3).setValues([['設定項目', '設定內容', '備註']]);
  var rows = [
    ['系統標題', '2026週年慶紀念品－吊飾', '前台頁首標題'],
    ['活動名稱', '2026週年慶紀念品－吊飾', ''],
    ['活動日期', '（示範）2026週年慶當日', '可自由填寫'],
    ['是否開放登記', '開放', '填「開放」才可登記，填「關閉」前台只顯示公告'],
    ['登記截止時間', '', '可留空；或填 2026/09/30 23:59'],
    ['公告文字', '歡迎登記購買 2026 週年慶紀念品吊飾，名額有限。', '前台公告 / 關閉時顯示'],
    ['成功頁提示文字', '取件或寄送時間將另行通知。', ''],
    ['郵寄費', 100, '選擇郵寄時加收'],
    ['週年慶當日取件是否開放', '開放', '是 / 否'],
    ['高雄道場提前取件是否開放', '開放', '是 / 否'],
    ['郵寄是否開放', '開放', '是 / 否']
  ];
  sh.getRange(2, 1, rows.length, 3).setValues(rows);
  sh.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#fde7c2');
  sh.setColumnWidth(1, 200); sh.setColumnWidth(2, 320); sh.setColumnWidth(3, 320);
  sh.setFrozenRows(1);
}

function setupProducts_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(SHEET_PRODUCTS)) return; // 已存在就不動，避免覆蓋你填的商品/圖片
  var sh = ss.insertSheet(SHEET_PRODUCTS);
  sh.getRange(1, 1, 1, PRD_HEADERS.length).setValues([PRD_HEADERS]);
  var rows = [
    ['P01', '週年慶吊飾', '2026 週年慶限定紀念吊飾，精緻質感、值得收藏。', 150,
     '', '', '是', 1, '是', 99, '可貼兩張 Google Drive 分享連結（正面／背面）']
  ];
  sh.getRange(2, 1, rows.length, PRD_HEADERS.length).setValues(rows);
  sh.getRange(1, 1, 1, PRD_HEADERS.length).setFontWeight('bold').setBackground('#fde7c2');
  sh.setColumnWidth(3, 320); sh.setColumnWidth(5, 280); sh.setColumnWidth(6, 280);
  sh.setFrozenRows(1);
}

// 選單：強制重建登記資料表（會清空）
function rebuildRecords() {
  setupRecords_(true);
  buildStats_();
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('登記資料表已重建。', '紀念品系統', 5);
  } catch (e) {}
}

/**
 * 登記資料表：
 * - 不存在 → 建立。
 * - 結構正確且非強制 → 保留資料，只補格式/下拉。
 * - 結構不符（或強制）→ 若有資料先跳確認，然後清空＋移除多餘欄位＋寫新表頭。
 */
function setupRecords_(force) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_RECORDS);

  if (!sh) {
    sh = ss.insertSheet(SHEET_RECORDS);
    rebuildRecordsSheet_(sh);
    return;
  }

  if (recordsHeaderOk_(sh) && !force) {
    applyRecordsFormat_(sh);
    return;
  }

  if (sh.getLastRow() > 1) {
    var ui = SpreadsheetApp.getUi();
    var resp = ui.alert('重建「登記資料」',
      '此動作會「清空登記資料表中現有的資料列」並套用最新欄位（單一商品、無小計）。\n\n若只是測試資料可直接清掉。要繼續嗎？',
      ui.ButtonSet.YES_NO);
    if (resp !== ui.Button.YES) {
      ss.toast('已略過「登記資料」重建。', '紀念品系統', 4);
      return;
    }
  }
  rebuildRecordsSheet_(sh);
}

function recordsHeaderOk_(sh) {
  if (sh.getLastColumn() !== REC_HEADERS.length) return false;
  var cur = sh.getRange(1, 1, 1, REC_HEADERS.length).getValues()[0];
  return REC_HEADERS.every(function (h, i) { return String(cur[i]).trim() === h; });
}

function rebuildRecordsSheet_(sh) {
  sh.clear();
  var extra = sh.getMaxColumns() - REC_HEADERS.length;
  if (extra > 0) sh.deleteColumns(REC_HEADERS.length + 1, extra);
  sh.getRange(1, 1, 1, REC_HEADERS.length).setValues([REC_HEADERS]);
  applyRecordsFormat_(sh);
}

function applyRecordsFormat_(sh) {
  sh.getRange(1, 1, 1, REC_HEADERS.length).setFontWeight('bold').setBackground('#fde7c2');
  sh.setFrozenRows(1);
  var maxRows = Math.max(sh.getMaxRows() - 1, 1);
  var payCol = REC_HEADERS.indexOf('付款狀態') + 1;
  var shipCol = REC_HEADERS.indexOf('取件／寄送狀態') + 1;
  var payRule = SpreadsheetApp.newDataValidation().requireValueInList(PAY_STATUS, true).build();
  var shipRule = SpreadsheetApp.newDataValidation().requireValueInList(SHIP_STATUS, true).build();
  sh.getRange(2, payCol, maxRows, 1).setDataValidation(payRule);
  sh.getRange(2, shipCol, maxRows, 1).setDataValidation(shipRule);
  applyDuplicateHighlight_(sh);  // 重複姓名自動標紅底
}

/* ====================== 統計頁（公式自動更新） ====================== */
function buildStats_() {
  var sh = getSheet_(SHEET_STATS);
  sh.clear();
  var R = "'" + SHEET_RECORDS + "'";   // 登記資料
  // 商品名稱（取商品設定第一/二列）
  var P = "'" + SHEET_PRODUCTS + "'";

  // 未取消的條件：是否取消欄(第26欄=Z)不是「是」
  // 為求穩定，統計以 登記資料 各欄字母對應 REC_HEADERS
  var col = {};
  REC_HEADERS.forEach(function (h, i) { col[h] = colLetter_(i + 1); });

  var notCancel = R + '!' + col['是否取消'] + '2:' + col['是否取消'];

  var rows = [
    ['統計項目', '數值'],
    ['登記總筆數', '=COUNTA(' + R + '!' + col['姓名'] + '2:' + col['姓名'] + ')'],
    ['商品名稱', '=IFERROR(' + P + '!B2,"")'],
    ['商品總數量', '=SUM(' + R + '!' + col['數量'] + '2:' + col['數量'] + ')'],
    ['商品總金額', '=SUM(' + R + '!' + col['商品總金額'] + '2:' + col['商品總金額'] + ')'],
    ['郵寄件數', '=COUNTIF(' + R + '!' + col['取貨方式'] + '2:' + col['取貨方式'] + ',"郵寄")'],
    ['郵寄費總額', '=SUM(' + R + '!' + col['郵寄費'] + '2:' + col['郵寄費'] + ')'],
    ['應收總金額', '=SUM(' + R + '!' + col['總金額'] + '2:' + col['總金額'] + ')'],
    ['已付款金額', '=SUMIF(' + R + '!' + col['付款狀態'] + '2:' + col['付款狀態'] + ',"已付款",' + R + '!' + col['總金額'] + '2:' + col['總金額'] + ')'],
    ['未付款金額', '=SUMIF(' + R + '!' + col['付款狀態'] + '2:' + col['付款狀態'] + ',"未付款",' + R + '!' + col['總金額'] + '2:' + col['總金額'] + ')'],
    ['週年慶當日取件人數', '=COUNTIF(' + R + '!' + col['取貨方式'] + '2:' + col['取貨方式'] + ',"週年慶當日取件")'],
    ['高雄道場提前取件人數', '=COUNTIF(' + R + '!' + col['取貨方式'] + '2:' + col['取貨方式'] + ',"提早至高雄道場取件")'],
    ['超商店到店件數', '=COUNTIF(' + R + '!' + col['配送方式'] + '2:' + col['配送方式'] + ',"超商店到店")'],
    ['宅配件數', '=COUNTIF(' + R + '!' + col['配送方式'] + '2:' + col['配送方式'] + ',"宅配地址")'],
    ['已取件數', '=COUNTIF(' + R + '!' + col['取件／寄送狀態'] + '2:' + col['取件／寄送狀態'] + ',"已取件")'],
    ['已寄出數', '=COUNTIF(' + R + '!' + col['取件／寄送狀態'] + '2:' + col['取件／寄送狀態'] + ',"已寄出")'],
    ['已完成數', '=COUNTIF(' + R + '!' + col['取件／寄送狀態'] + '2:' + col['取件／寄送狀態'] + ',"已完成")']
  ];
  sh.getRange(1, 1, rows.length, 2).setValues(rows);
  sh.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#fde7c2');
  sh.setColumnWidth(1, 220); sh.setColumnWidth(2, 280);
  sh.setFrozenRows(1);
}

function colLetter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
