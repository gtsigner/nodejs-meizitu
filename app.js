/**
 * @Author:zhaojunlike
 * @Github:https://github.com/zhaojunlike
 * Created by zhaojunlike on 6/4/2017.
 */
const http = require("http");
const querystring = require("querystring");
const restify = require('restify-clients');
const log4js = require("log4js");
const request = require('request');
const cheerio = require('cheerio');
const redis = require("redis");
const process = require("process");
const download = require('download');
const redisConn = redis.createClient({
    //host: "redis-db",
    host: "192.168.99.100",
    port: "6379",
});
const url = require('url');
const fs = require('fs');
const path = require('path');
const RequestHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.3047.4 Safari/537.36",
    "Host": "www.mzitu.com",
};
const webClient = restify.createStringClient({
    url: 'http://www.mzitu.com',
    headers: RequestHeaders
});
const serverApiClient = restify.createStringClient({
    url: 'http://192.168.99.1:8080',
    //url: 'http://192.168.99.100:81',
    headers: RequestHeaders
});
const RedisConfig = {};
const RegxConfig = {
    index_tag: /<dl(.*?)class="tags">([\s\S]*?)<\/dl>/g,
};
const CacheKeys = {
    index_tag: "index_tag_queue",
    tag_list: "tag_list_queue",
    taotu_list: "taotu_list",
    page_count: "page_count",
    page_detail: "page_detail_queue",
    img_download_url: "img_queue",
};
const RemoteConfig = {
    host: 'http://www.mzitu.com',
    zhuanti: 'http://www.mzitu.com/zhuanti/',
    page: 'http://www.mzitu.com/page/',

};
const ServerApi = {
    DocumentAdd: "/Document_add.action",
    PictureAdd: "/Picture_add.action",
};
let SpiderIDLE = {
    start: false,
    index_success: false,
    img_page_success: false,
    img_down_success: false,
    img_taotu_success: false,
    //BASE_PATH: "../storage/download",
    BASE_PATH: "../storage"
};

const Tools = {
    parseUri: function (uri) {
        let filePath = url.parse(uri).path;
        let tmp = filePath.split('/');
        return {
            filename: tmp.pop(),
            filepath: tmp.join("/")
        };
    },
    checkDir: function (dirPath) {
        let mode = 777;
        if (!fs.existsSync(dirPath)) {
            let tmp;
            dirPath.split('/').forEach(function (dirname) {
                if (tmp) {
                    tmp = path.join(tmp, dirname);
                }
                else {
                    tmp = dirname;
                }
                if (!fs.existsSync(tmp)) {
                    if (!fs.mkdirSync(tmp, mode)) {
                        return false;
                    }
                }
            });
        }
        return true;
    }
};

const Spider = {
    start: function () {
        webClient.get('/zhuanti/', function (err, req, res, data) {
            if (err) {
                return err;
            }
            let $ = cheerio.load(data);
            $(".postlist .tags dd").each(function (index, item) {
                let $this = $(this);
                let tag = {};
                tag.title = $this.find('img').attr("alt");
                tag.banner = $this.find('img').attr("src");
                tag.url = $this.find("a").attr("href");
                //pop进入队列
                redisConn.rpush(CacheKeys.index_tag, JSON.stringify(tag), function (err, reply) {
                    console.log(err, reply);
                });
            });
        });
    },
    //1.获取首页,获取首页有多少个pageCount
    getPageList: function (callback) {
        webClient.get('/', function (err, req, res, data) {
            if (err) {
                return err;
            }
            let $ = cheerio.load(data);
            $(".nav-links a[class='page-numbers']").each(function (index, item) {
                let $this = $(this);
                //pop进入队列
                let html = $this.html();
                let page = html.match(/\d+/);
                if (parseInt(page)) {
                    redisConn.getset(CacheKeys.page_count, page);
                }
            });
            redisConn.get(CacheKeys.page_count, function (err, reply) {
                callback(reply);
            });
        });
    },
    //2.加入套图页面数据,就是套图的数据
    getImgPage: function (callback) {
        redisConn.decr(CacheKeys.page_count, function (err, reply) {
            if (err || !reply) {
                return false;
            }
            if (parseInt(reply) <= 1) {
                console.log("页面套图数据已经采集完毕了!!!!");//
                SpiderIDLE.img_page_success = true;
                return false;
            }
            console.log(`开始采集页面:${reply}`);
            //采集这个页面
            webClient.get(`/page/${reply}/`, function (err, req, res, data) {
                if (err || !data) {
                    return false;
                }
                let $ = cheerio.load(data);
                $(".postlist #pins li").each(function (index, item) {
                    let $this = $(this);
                    let document = {
                        title: "",
                        url: "",
                        remote_path: '/',
                        content: "",
                        page_num: "",
                        category_id: "",
                        create_time: "",
                        update_time: "",
                        good_count: 0,
                        view_count: 0,
                        remote_id: 0,
                    };
                    document.create_time = $this.find(".time").html();
                    document.view_count = Math.random() * 1000000;
                    document.title = $this.find("img").attr("alt");
                    document.url = $this.find("a").attr("href");
                    document.remote_id = document.url.match(/\d+/)[0];
                    document.remote_path = '/' + document.remote_id;
                    document.content = $this.find("img").attr("data-original");
                    document.category_id = reply;
                    document.page_num = reply;
                    //加入队列
                    //TODO 写入gateway接口
                    redisConn.rpush(CacheKeys.page_detail, JSON.stringify(document), function (err, reply) {
                        callback(document);
                    });
                });
            });

        });
    },
    //3.采集套图具体图片，就是套图数量的数据
    getTaoTuImgs: function (callback) {
        redisConn.lpop(CacheKeys.page_detail, function (err, reply) {
            if (err || !reply) return;
            let document = JSON.parse(reply);
            let rePath = document.remote_path = '/' + document.url.match(/\d+/)[0];
            console.log("PATH:", rePath);
            webClient.get(rePath, function (err, req, res, data) {
                if (err || !data) return;
                let $ = cheerio.load(data);
                let pageCount = $(".main .pagenavi a span").eq(-2).html();
                document.detail_count = pageCount;
                //动态生成链接图片链接
                console.log(`获取套图：${document.category_id},${pageCount}张`);
                for (let i = 2; i <= pageCount; i++) {
                    let img = {
                        category_id: document.category_id,
                        img_url: document.url + "/" + i,
                        remote_id: document.remote_id,
                        remote_path: document.remote_path + "/" + i
                    };
                    //这里可能直接push了10张图进去
                    redisConn.rpush(CacheKeys.img_download_url, JSON.stringify(img), function (err, reply) {
                        console.log(`加入套图:${img.remote_id}`, err);
                    });
                }
            });
        });
    },
    //4.具体下载
    downloadYY: function (callback) {
        //下载图片
        redisConn.lpop(CacheKeys.img_download_url, function (err, reply) {
            if (err || !reply) {
                return false;
            }
            let img = JSON.parse(reply);
            webClient.get(img.remote_path, function (err, req, res, data) {
                if (err) {
                    console.log(err);
                    return;
                }
                if (err || !data) return;
                let $ = cheerio.load(data);
                //找到图片并且下载
                let urlImg = $(".main .main-image img").attr("src");
                img.url_img = urlImg;
                img.path = `/${img.category_id}/`;

                let fileDetail = Tools.parseUri(urlImg);
                let savePath = `${SpiderIDLE.BASE_PATH}/images/${img.category_id}${fileDetail.filepath}`;
                img.location = `/images/${img.category_id}${fileDetail.filepath}/${fileDetail.filename}`;
                Tools.checkDir(savePath);
                download(urlImg, savePath).then(function () {
                    console.log("下载真实大图:", urlImg, ",存储:", img.location);
                    callback(img);
                });
            });
        });

    },
    downloadThumbs: function () {

    },
    clearRedis: function () {
        redisConn.flushdb(function (err) {
            console.log("清空Redis Cache成功", err);
        });
    },
};

//Spider.clearRedis();
const SpiderTimer = setInterval(function () {
    if (SpiderIDLE.start !== true) {
        return false;
    }
    if (SpiderIDLE.img_page_success !== true) {
        Spider.getImgPage(function (document) {
            let urlImg = document.content;
            //1.下载到本地进行存储
            let fileDetail = Tools.parseUri(urlImg);
            let savePath = SpiderIDLE.BASE_PATH + '/banner' + fileDetail.filepath;
            Tools.checkDir(savePath);
            download(urlImg, savePath).then(function () {
                console.log("DownloadThumbsImg:", urlImg, "SavePath:", savePath);
            });

            //2.提交给服务器,这个只是页面的
            document.content = "/banner" + fileDetail.filepath + "/" + fileDetail.filename;
            document.view_count = parseInt(document.view_count);
            serverApiClient.post(ServerApi.DocumentAdd, document, function (err, req, res, data) {
                console.log(`图片Document:${document.category_id},写入服务器成功`);
            });

        });
    }
    Spider.downloadYY(function (picture) {
        serverApiClient.post(ServerApi.PictureAdd, picture, function (err, req, res, data) {
            console.log(`真实Picture:${picture.remote_id},存储服务器成功`);
        });
    });
    Spider.getTaoTuImgs(function (document) {

    });
}, 100);


Spider.getPageList(function (count) {
    console.log(`一共有:${count}个页面需要采集`);
    SpiderIDLE.start = true;
});



process.on("exit", function () {
    redisConn.end(true);
    clearInterval(SpiderTimer);
    Spider.clearRedis();
    console.log("exit");
});