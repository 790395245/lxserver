
export const sizeFormate = (size) => {
    if (!size) return '0 B'
    let units = ['B', 'KB', 'MB', 'GB', 'TB']
    let number = Math.floor(Math.log(size) / Math.log(1024))
    return `${(size / Math.pow(1024, Math.floor(number))).toFixed(2)} ${units[number]}`
}

const numFix = (n) => n < 10 ? (`0${n}`) : n.toString()

// Basic HTML entity decode for Node.js
export const decodeName = (str) => {
    if (!str) return ''
    const entities = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&apos;': "'",
        '&nbsp;': ' '
    }
    return str.replace(/&[a-zA-Z]+;/g, match => entities[match] || match)
}

/**
 * 格式化播放时间
 * @param {number} time 
 */
export const formatPlayTime = (time) => {
    let m = Math.trunc(time / 60)
    let s = Math.trunc(time % 60)
    return m == 0 && s == 0 ? '--/--' : numFix(m) + ':' + numFix(s)
}

export const dateFormat = (_date, format = 'Y-M-D h:m:s') => {
    const date = new Date(_date)
    if (!date) return ''
    return format
        .replace('Y', date.getFullYear().toString())
        .replace('M', numFix(date.getMonth() + 1))
        .replace('D', numFix(date.getDate()))
        .replace('h', numFix(date.getHours()))
        .replace('m', numFix(date.getMinutes()))
        .replace('s', numFix(date.getSeconds()))
}

