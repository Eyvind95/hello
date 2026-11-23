'use strict';
globalThis.ArchiveManagerNames = {
  separator: /[、，,;；\r\n]/u,
  read(profile) {
    const values = Array.isArray(profile?.managerNames) ? profile.managerNames :
      String(profile?.manager || '').split(this.separator);
    return [...new Set(values.filter(name => typeof name === 'string').map(name => name.trim()).filter(Boolean))];
  },
  form(first, second) {
    const names = [first.trim(), second.trim()];
    if (!names[0] || names.some(name => this.separator.test(name))) {
      throw new Error('請填寫第一位副駕駛，每欄只填一位名稱。');
    }
    if (names[0] === names[1]) throw new Error('兩位副駕駛的名稱不能相同。');
    return names.filter(Boolean);
  }
};