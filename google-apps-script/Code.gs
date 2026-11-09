/** Read-only feed. Set the script property SPREADSHEET_ID before deployment. */
function doGet() {
  try {
    const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (!id) throw new Error('SPREADSHEET_ID is not configured');
    const sheet = SpreadsheetApp.openById(id).getSheetByName('単語マスター');
    if (!sheet) throw new Error('単語マスター tab is missing');
    const values = sheet.getDataRange().getValues();
    const headers = values.shift().map(value => String(value).trim());
    const columns = ['id', 'word', 'meaning', 'range', 'active', 'updated_at', 'sources'];
    const requiredColumns = columns.slice(0, 6);
    if (new Set(headers).size !== headers.length || !requiredColumns.every(name => headers.includes(name))) {
      throw new Error('Headers must include id, word, meaning, range, active, updated_at');
    }
    const words = values.filter(row => row.some(value => value !== '')).map(row => {
      const item = {};
      columns.forEach(name => {
        const index = headers.indexOf(name);
        const value = index < 0 ? '' : row[index];
        item[name] = value instanceof Date ? value.toISOString() : value;
      });
      ['id', 'word', 'meaning', 'range', 'sources'].forEach(name => { item[name] = String(item[name]).trim(); });
      if (!item.id || !item.word || !item.meaning) throw new Error('id, word, meaning must not be empty');
      const active = String(item.active).trim().toLowerCase();
      if (!['', 'true', 'false'].includes(active)) throw new Error('active must be TRUE or FALSE');
      item.active = active !== 'false';
      return item;
    });
    return jsonOutput({ words: words });
  } catch (error) {
    return jsonOutput({ error: String(error.message) });
  }
}

function jsonOutput(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
