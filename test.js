const url = require('url');
const fs = require('fs');
const download = require('download');
let res = url.parse('http://i.meizitu.net/thumbs/2013/06/26926_20140711w1811_236.jpg');
const path = require('path');

function mkdirsSync(dirPath, mode) {
    if (!fs.existsSync(dirPath)) {
        let tmp;
        dirPath.split('/').forEach(function (dirname) {
            if (tmp) {
                tmp = path.join(tmp, dirname);
            }
            else {
                tmp = dirname;
            }
            console.log(tmp);
            if (!fs.existsSync(tmp)) {
                if (!fs.mkdirSync(tmp, mode)) {
                    return false;
                }
            }
        });
    }
    return true;
}
let pat = res.pathname.split('/');
pat.pop();
console.log(pat.join("/"));
download('http://i.meizitu.net/thumbs/2013/06/26926_20140711w1811_236.jpg').then(data => {
    mkdirsSync("." + res.pathname, 777);
    fs.writeFileSync(`./download${res.pathname}`, data);
});

console.log(res);