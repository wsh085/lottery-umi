import { useMemo } from "react";
import { last, uniq } from "lodash-es";
import { Line } from "@ant-design/plots";
import {
  Alert,
  Button,
  Col,
  Empty,
  Form,
  InputNumber,
  Modal,
  Row,
  Select,
} from "antd";
import { getHistoryData } from "@/utils";
import { FORM_ITEM_LAYOUT } from "@/utils/constants";
import useObjectState from "@/hooks/useObjectState";

const Ways = [
  {
    value: "五码互减杀号法 - 减第一位",
    label: "五码互减杀号法 - 减第一位",
    desc: "将上期开出的第一位作为所减号码，用上期所开出的前区第二位、第三位、第四位、第五位，减去第一位号码，所得出的数字即为选号的所杀号码。",
  },
  {
    value: "五码互减杀号法 - 减第二位",
    label: "五码互减杀号法 - 减第二位",
    desc: "用上期最大3个号码分别减去上期第二位号码，得出的3个数即为选号的所杀号码。",
  },
  {
    value: "加3杀号法",
    label: "加3杀号法",
    desc: "将上期前区5个号码分别加3，得出的5个号码即为选号的所杀号码。",
  },
  {
    value: "前两期前3个号码互减杀号法",
    label: "前两期前3个号码互减杀号法",
    desc: "用前区最近二期前面3个号码互减，注意要用大号减小号，同位相减得出的3个数绝杀",
  },
  {
    value: "前区最小3个号码减值杀号法",
    label: "前区最小3个号码减值杀号法",
    desc: "用前区最小3个号码依此减去1、减去2、减去3得出3个数绝杀。",
  },
];
/**
 * 前区杀号
 * @returns
 */
const PreShaHaoStatistics = () => {
  const [params, updateParams] = useObjectState<{
    count?: number;
    key?: string;
  }>({
    count: undefined,
    key: undefined,
  });

  const historyData = useMemo(() => {
    return getHistoryData(params.count);
  }, [params.count]);

  /**
   * 五码互减杀号法
   *
   * index 是要减的数字的索引位置，默认为0，即第一个数
   *
   * 算出每期使用这个方法杀的号的准确率
   */
  const wumahujian = (data: any, index = 0) => {
    const result = [];
    for (let i = 1; i < data.length; i++) {
      // 取出当期的号码
      const currentNumber = data[i]["红球"]
        .split(" ")
        ?.map((n: any) => Number(n));
      // 取出 上一期 的5个号码
      const preNumber = data[i - 1]["红球"]
        .split(" ")
        ?.map((n: any) => Number(n));
      const killNumbers: Number[] = [];
      preNumber.forEach((d: number, i: number) => {
        if (i > index) {
          killNumbers.push(d - preNumber[index]);
        }
      });
      // 准确率
      const precision =
        killNumbers.filter((n) => !currentNumber.includes(n))?.length /
        killNumbers.length;

      result.push({
        ...data[i],
        准确率: precision,
        杀号: killNumbers,
      });
    }
    return result;
  };

  /**
   * 加3 杀号法
   *
   * 算出每期使用这个方法杀的号的准确率
   */
  const jia3 = (data: any) => {
    const result = [];
    for (let i = 1; i < data.length; i++) {
      // 取出当期的号码
      const currentNumber = data[i]["红球"]
        .split(" ")
        ?.map((n: any) => Number(n));
      // 取出 上一期 的5个号码
      const preNumber = data[i - 1]["红球"]
        .split(" ")
        ?.map((n: any) => Number(n));
      const killNumbers: Number[] = [];
      preNumber.forEach((d: number, i: number) => {
        let sum: any = d + 3;
        if (sum <= 35) {
          killNumbers.push(d + 3);
        } else {
          sum = String(sum);
          killNumbers.push(Number(`2${sum[1]}`));
        }
      });
      // 准确率
      const precision =
        killNumbers.filter((n) => !currentNumber.includes(n))?.length /
        killNumbers.length;

      result.push({
        ...data[i],
        准确率: precision,
        杀号: killNumbers,
      });
    }
    return result;
  };

  /**
   * 前两期前3个号码互减杀号法
   *
   * 算出每期使用这个方法杀的号的准确率
   */
  const threeNumberhujian = (data: any) => {
    const result = [];
    for (let i = 2; i < data.length; i++) {
      // 取出当期的号码
      const currentNumber = data[i]["红球"]
        .split(" ")
        ?.map((n: any) => Number(n));
      // 取出 上一期 的5个号码
      const preNumber = data[i - 1]["红球"]
        .split(" ")
        ?.map((n: any) => Number(n));

      // 取出 上上期 的5个号码
      const pre2Number = data[i - 2]["红球"]
        .split(" ")
        ?.map((n: any) => Number(n));

      const killNumbers: Number[] = [];
      preNumber.forEach((d: number, i: number) => {
        if (i < 3) {
          const differenceValue = Math.abs(d - pre2Number[i]);
          killNumbers.push(differenceValue === 0 ? 10 : differenceValue);
        }
      });
      // 准确率
      const precision =
        killNumbers.filter((n) => !currentNumber.includes(n))?.length /
        killNumbers.length;

      result.push({
        ...data[i],
        准确率: precision,
        杀号: killNumbers,
      });
    }
    return result;
  };

  /**
   * 前区最小3个号码减值杀号法
   */
  const threeNumberJianNumber = (data: any) => {
    const result = [];
    for (let i = 1; i < data.length; i++) {
      // 取出当期的号码
      const currentNumber = data[i]["红球"]
        .split(" ")
        ?.map((n: any) => Number(n));
      // 取出 上一期 的5个号码
      const preNumber = data[i - 1]["红球"]
        .split(" ")
        ?.map((n: any) => Number(n));

      const killNumbers: Number[] = [];
      preNumber.forEach((d: number, i: number) => {
        if (i < 3) {
          const differenceValue = Math.abs(d - (i + 1));
          killNumbers.push(differenceValue === 0 ? 10 : differenceValue);
        }
      });
      // 准确率
      const precision =
        killNumbers.filter((n) => !currentNumber.includes(n))?.length /
        killNumbers.length;

      result.push({
        ...data[i],
        准确率: precision,
        杀号: killNumbers,
      });
    }
    return result;
  };

  const config = useMemo(() => {
    if (params.key) {
      let data: any = [];
      if (params.key === "五码互减杀号法 - 减第一位") {
        data = wumahujian(historyData)?.map((d) => {
          return {
            期数: d["期数"].substring(d["期数"].length - 3),
            准确率: Number(d["准确率"]),
            红球: d["红球"],
          };
        });
      } else if (params.key === "五码互减杀号法 - 减第二位") {
        data = wumahujian(historyData, 1)?.map((d) => {
          return {
            期数: d["期数"].substring(d["期数"].length - 3),
            准确率: Number(d["准确率"]),
            红球: d["红球"],
          };
        });
      } else if (params.key === "加3杀号法") {
        data = jia3(historyData)?.map((d) => {
          return {
            期数: d["期数"].substring(d["期数"].length - 3),
            准确率: Number(d["准确率"]),
            红球: d["红球"],
          };
        });
      } else if (params.key === "前两期前3个号码互减杀号法") {
        data = threeNumberhujian(historyData)?.map((d) => {
          return {
            期数: d["期数"].substring(d["期数"].length - 3),
            准确率: Number(d["准确率"]),
            红球: d["红球"],
          };
        });
      } else if (params.key === "前区最小3个号码减值杀号法") {
        data = threeNumberJianNumber(historyData)?.map((d) => {
          return {
            期数: d["期数"].substring(d["期数"].length - 3),
            准确率: Number(d["准确率"]),
            红球: d["红球"],
          };
        });
      }

      return {
        data,
        xField: "期数",
        yField: "准确率",
        scale: {
          // 设置 Y轴 值范围
          y: {
            domainMin: 0,
            domainMax: 1,
          },
        },
        point: {
          shapeField: "square",
          sizeField: 4,
        },
        interaction: {
          tooltip: {
            marker: false,
            render: (event: any, { title, items }: any) => {
              return (
                <div>
                  {items.map((item: any) => {
                    return (
                      <div>
                        {item.name}：{item.value}
                      </div>
                    );
                  })}
                </div>
              );
            },
          },
        },
        tooltip: {
          items: [
            {
              name: "期数",
              field: "期数",
            },
            {
              name: "准确率",
              field: "准确率",
            },
            {
              name: "红球",
              field: "红球",
            },
          ],
        },
        style: {
          lineWidth: 2,
        },
      };
    }
    return {};
  }, [historyData, params.key]);

  /**
   * 获取杀号
   */
  const handleShaHao = () => {
    const result: Record<string, number[]> = {};
    let data = [];
    let killNumbers: number[] = [];
    Ways.forEach((item) => {
      if (item.value === "五码互减杀号法 - 减第一位") {
        data = wumahujian(historyData);
        result[item.value] = last(data)["杀号"];
        killNumbers = [...killNumbers, ...result[item.value]];
      } else if (item.value === "五码互减杀号法 - 减第二位") {
        data = wumahujian(historyData, 1);
        result[item.value] = last(data)["杀号"];
        killNumbers = [...killNumbers, ...result[item.value]];
      } else if (item.value === "加3杀号法") {
        data = jia3(historyData);
        result[item.value] = last(data)["杀号"];
        killNumbers = [...killNumbers, ...result[item.value]];
      } else if (item.value === "前两期前3个号码互减杀号法") {
        data = threeNumberhujian(historyData);
        result[item.value] = last(data)["杀号"];
        killNumbers = [...killNumbers, ...result[item.value]];
      } else if (item.value === "前区最小3个号码减值杀号法") {
        data = threeNumberJianNumber(historyData);
        result[item.value] = last(data)["杀号"];
        killNumbers = [...killNumbers, ...result[item.value]];
      }
    });
    Modal.info({
      title: `本期推荐的杀号: ${uniq(killNumbers)
        .sort((a, b) => a - b)
        .join("  ")}`,
      content: (
        <div>
          {Object.keys(result).map((key) => {
            return (
              <div>
                {key}：{result[key].join("  ")}
              </div>
            );
          })}
        </div>
      ),
    });
  };

  // #region 渲染DOM
  return (
    <div>
      <Form {...FORM_ITEM_LAYOUT}>
        <Row>
          <Col span={8}>
            <Form.Item label="期数" name="count">
              <InputNumber
                className="w-1-1"
                placeholder="请输入，不填默认近50期"
                min={1}
                max={50}
                onChange={(v) =>
                  updateParams({
                    count: v as number,
                  })
                }
              />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="方法" name="key">
              <Select
                placeholder="请选择"
                className="w-1-1"
                onChange={(v) =>
                  updateParams({
                    key: v as string,
                  })
                }
                options={Ways}
              />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Button onClick={() => handleShaHao()}>获取当期的杀号</Button>
          </Col>
        </Row>
      </Form>
      {!params.key ? (
        <Empty
          description={
            <span>
              请先选择 <span className="text-orange">方法</span>
            </span>
          }
        />
      ) : (
        <>
          <Alert
            message={
              Ways.find((item) => item.value === params.key!)?.desc ||
              "方法说明"
            }
            type="info"
            className="mb-24"
          />
          <Line {...config} />
        </>
      )}
    </div>
  );
};

export default PreShaHaoStatistics;
