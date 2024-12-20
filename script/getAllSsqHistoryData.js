const puppeteer = require("puppeteer");
const fs = require("fs");

const url = "https://tb.tuganjue.com/tgj-ssq-kjfb.html";

(async () => {
  // 启动 Puppeteer 浏览器
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();

  // 访问目标网页
  await page.goto(url); // 替换为你的目标网址

  // 等待 `historyData` 元素加载，设置超时可以避免无限等待
  await page.waitForSelector("#tb_body", { timeout: 200000 });

  // 监听页面的 console 事件来捕获日志
  page.on("console", (msg) => {
    for (let i = 0; i < msg.args().length; ++i)
      console.log(`${i}: ${msg.args()[i]}`); // 输出 console.log 的内容
  });

  // 获取历史数据
  const content = await page.evaluate(async () => {
    // 获取每期选中的号码
    const getLotteryData = () => {
      const result = [];

      let historyDataTBody = document.getElementById("body");

      let historyDataTr = historyDataTBody.children;

      for (let i = 0; i < historyDataTr.length; i++) {
        if (historyDataTr[i].className === "tr") {
          // 排除掉非开奖号码的行
          const tdData = historyDataTr[i].children;
          const trData = {};
          let red = []; // 红球
          let blue = []; // 蓝球

          for (let j = 0; j < tdData.length; j++) {
            if (j === 1) {
              trData["期数"] = tdData[j].textContent;
            } else if (j === 2) {
              const qiuData = tdData[j].children;
              for (let k = 0; k < qiuData.length; k++) {
                if (k <= 5) {
                  red.push(qiuData[k].textContent);
                } else {
                  blue.push(qiuData[k].textContent);
                }
              }
            } else if (tdData[j].className === "hz") {
              // 取和值
              trData["和值"] = tdData[j].textContent;
            } else if (tdData[j].className === "hw") {
              // 取和尾
              trData["和尾"] = tdData[j].textContent;
            } else if (tdData[j].className === "kd") {
              // 取跨度
              trData["跨度"] = tdData[j].textContent;
            } else if (tdData[j].className === "dx") {
              // 取大小比
              trData["大小比"] = tdData[j].textContent;
            } else if (tdData[j].className === "jo") {
              // 取奇偶比
              trData["奇偶比"] = tdData[j].textContent;
            } else if (tdData[j].className === "zh") {
              // 取质合比
              trData["质合比"] = tdData[j].textContent;
            } else if (tdData[j].className === "lye") {
              // 取012路
              trData["012路"] = tdData[j].textContent;
            } else if (tdData[j].className === "dzx") {
              // 取大中小
              trData["大中小"] = tdData[j].textContent;
            }
          }
          result.push({
            ...trData,
            蓝球: blue?.join(" "),
            红球: red?.join(" "),
          });
        }
      }
      return result;
    };

    const result = getLotteryData();

    console.info(result.length);

    return JSON.stringify(result, null, 2);
  });

  if (content) {
    fs.writeFileSync(`./dSsq/temp_all_history_data.json`, content, "utf8");
  } else {
    console.log("Element not found in iframe.");
  }

  console.log(`========= 数据获取成功 =================`);
  // 关闭浏览器
  await browser.close();
})();

// 拉取历史全部数据的页面模拟方法
// 启动 Puppeteer 浏览器
// const browser = await puppeteer.launch({ headless: "new" });
// const page = await browser.newPage();

// // 访问目标网页
// await page.goto(url); // 替换为你的目标网址

// // 等待 `historyData` 元素加载，设置超时可以避免无限等待
// await page.waitForSelector("#tb_body", { timeout: 200000 });

// // 设置localStorage
// await page.evaluate(() => {
//   localStorage.setItem("limit", 300);
// });

// await page.reload();

// // 等待 `historyData` 元素加载，设置超时可以避免无限等待
// await page.waitForSelector("#tb_body", { timeout: 200000 });

// await page.click(".btn-next");
// await page.click(".btn-next");
