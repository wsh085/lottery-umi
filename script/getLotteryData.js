const puppeteer = require("puppeteer");
const fs = require("fs");

const url =
  "https://lotto.sina.cn/trend/qxc_qlc_proxy.d.html?lottoType=dlt&actionType=chzs&0_ala_h5baidu&_headline=baidu_ala";

(async () => {
  // 启动 Puppeteer 浏览器
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  // 访问目标网页
  await page.goto(url); // 替换为你的目标网址

  // 等待 `historyData` 元素加载，设置超时可以避免无限等待
  await page.waitForSelector(".chart", { timeout: 20000 });

  const getFormatDate = () => {
    let currentDate = new Date();
    let year = currentDate.getFullYear();
    let month = currentDate.getMonth() + 1;
    let day = currentDate.getDate();
    let hours = currentDate.getHours();
    let minutes = currentDate.getMinutes();
    let seconds = currentDate.getSeconds();

    const format = (number) => {
      return number < 10 ? `0${number}` : number;
    };
    return `${year}${format(month)}${format(day)}_${format(hours)}${format(
      minutes
    )}${format(seconds)}`;
  };

  // 获取历史数据
  const content = await page.evaluate(() => {
    // 获取每期选中的号码
    const getLotteryData = () => {
      const result = [];

      let historyDataTBody = document.getElementById("cpdata");

      let historyDataTr = historyDataTBody.children;

      for (let i = 0; i < historyDataTr.length; i++) {
        const tdData = historyDataTr[i].children;
        const trData = {};
        let red = []; // 红球
        let blue = []; // 蓝球

        for (let j = 0; j < tdData.length; j++) {
          if (j === 0) {
            trData["期数"] = tdData[j].textContent;
          } else if (tdData[j].className === "chartball02") {
            // 蓝球选中
            blue.push(tdData[j].textContent);
          } else if (tdData[j].className?.indexOf("chartball") > -1) {
            // 红球选中
            red.push(tdData[j].textContent);
          } else if (j === 55) {
            // 取和值
            trData["和值"] = tdData[j].textContent;
          } else if (j === 56) {
            // 取跨度
            trData["跨度"] = tdData[j].textContent;
          } else if (j === 57) {
            // 取 区间比
            if (tdData[j].children?.length) {
              trData["区间比"] = tdData[j].children[0]?.textContent;
            } else {
              trData["区间比"] = tdData[j]?.textContent;
            }
          } else if (j === 58) {
            // 取 奇偶比
            if (tdData[j].children?.length) {
              trData["奇偶比"] = tdData[j].children[0]?.textContent;
            } else {
              trData["奇偶比"] = tdData[j]?.textContent;
            }
          }
        }
        result.push({
          ...trData,
          蓝球: blue?.join(" "),
          红球: red?.join(" "),
        });
      }
      return result;
    };
    const result = getLotteryData();

    return JSON.stringify(result, null, 2);
  });

  if (content) {
    fs.writeFileSync(`./data/history_data.json`, content, "utf8");
  } else {
    console.log("Element not found in iframe.");
  }

  const dataAnalysis = await page.evaluate(() => {
    // 数据统计值
    const getDataAnalysis = () => {
      const result = {};

      let historyDataTBody = document.getElementById("now_gross");

      let historyDataTr = historyDataTBody.children;

      for (let i = 0; i < historyDataTr.length; i++) {
        const tdData = historyDataTr[i].children;
        const blue = [];
        const red = [];
        const map = {
          蓝球: {},
          红球: {},
        };

        for (let j = 0; j < tdData.length; j++) {
          if (
            j !== 0 &&
            tdData[j].className !== "br01" &&
            tdData[j].textContent !== ""
          ) {
            if (j < 40) {
              // 红球
              red.push(tdData[j].textContent);
            } else {
              // 蓝球
              blue.push(tdData[j].textContent);
            }
          }
        }
        blue.forEach((number, index) => {
          map["蓝球"][index + 1] = number;
        });
        red.forEach((number, index) => {
          map["红球"][index + 1] = number;
        });
        result[tdData[0].textContent] = map;
      }
      return result;
    };
    const result = getDataAnalysis();

    return JSON.stringify(result, null, 2);
  });

  if (dataAnalysis) {
    fs.writeFileSync(`./data/analysis_data.json`, dataAnalysis, "utf8");
  } else {
    console.log("Element not found in iframe.");
  }

  console.log(`========= 数据获取成功 =================`);
  // 关闭浏览器
  await browser.close();
})();
