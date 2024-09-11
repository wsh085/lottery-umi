import { useMemo } from "react";
import { last, uniq } from "lodash-es";
import { Line } from "@ant-design/plots";
import {
  Alert,
  Button,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
} from "antd";
import { getHistoryData } from "@/utils";
import { FORM_ITEM_LAYOUT } from "@/utils/constants";
import useObjectState from "@/hooks/useObjectState";

/** 偏态值 */
const PianTaiZhi = 18;

/**
 * 偏态分析法
 *
 * 超级大乐透“35选5”是随机摇号，在开出的号码中，形成偏态的可能性比较大，因此在偏态产生后，纠正偏态是下一步要做的事情
 *
 * 首先设定一个偏态参考值18（因为35个前区号码的中间号即为18），把1——35所有的数字都减去18，这样就会形成-17到17的序列，
 *
 * 用正负数的概念来判断偏态与否，最后形成的和值如果在正负18之间就可以认为是正常范围，超过18则是大偏态，小于-18则是小偏态
 *
 * @returns
 */
const PianTaiFenXi = () => {
  const [params, updateParams] = useObjectState<{
    count?: number;
    key?: string;
    piantai?: string;
  }>({
    count: undefined,
    key: "偏态值",
    piantai: undefined,
  });

  const historyData = useMemo(() => {
    return getHistoryData(params.count);
  }, [params.count]);

  /**
   * 计算偏态值
   *
   * 将5个号码都减去18，最好得到的和值就是该期的红球偏态值
   * @returns
   */
  const calculatePianTaiZhi = (data: any) => {
    const result = [];
    for (let i = 0; i < data.length; i++) {
      // 取出当期的号码
      const currentNumber = data[i]["红球"]
        .split(" ")
        ?.map((n: any) => Number(n));

      const differenceValue: number[] = [];
      currentNumber.forEach((d: number, i: number) => {
        differenceValue.push(d - PianTaiZhi);
      });
      // 偏态值
      const v = differenceValue.reduce(
        (sum: number, value: number) => sum + value,
        0
      );

      result.push({
        ...data[i],
        偏态值: v,
      });
    }
    return result;
  };

  const config = useMemo(() => {
    if (params.key) {
      const data = calculatePianTaiZhi(historyData)?.map((d) => {
        return {
          期数: d["期数"].substring(d["期数"].length - 3),
          [params.key!]: Number(d[params.key!]),
          红球: d["红球"],
        };
      });
      return {
        data,
        xField: "期数",
        yField: params.key,
        annotations: [
          {
            type: "lineY",
            yField: 18,
            style: { stroke: "#F4664A", strokeOpacity: 1, lineWidth: 1 },
          },
          {
            type: "lineY",
            yField: -18,
            style: { stroke: "#F4664A", strokeOpacity: 1, lineWidth: 1 },
          },
        ],
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
              name: params.key,
              field: params.key,
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
          {/* <Col span={8}>
            <Form.Item label="维度" name="key">
              <Select
                placeholder="请选择"
                className="w-1-1"
                onChange={(v) =>
                  updateParams({
                    key: v as string,
                  })
                }
                options={[
                  { value: "和值", label: "和值" },
                  { value: "跨度", label: "跨度" },
                  { value: "区间比", label: "区间比" },
                  { value: "奇偶比", label: "奇偶比" },
                ]}
              />
            </Form.Item>
          </Col> */}

          <Col span={8}>
            <Form.Item label="计算偏态值" name="piantai">
              <Input
                placeholder="请输入号码，以两个空格分隔"
                className="w-4-5"
                onChange={(e) =>
                  updateParams({
                    piantai: e.target.value,
                  })
                }
              />
              <Button
                onClick={() => {
                  const numbers: any = params.piantai
                    ?.split("  ")
                    ?.map((v) => Number(v));
                  const differenceValue: number[] = [];
                  numbers.forEach((d: number) => {
                    differenceValue.push(d - PianTaiZhi);
                  });
                  // 偏态值
                  const v = differenceValue.reduce(
                    (sum: number, value: number) => sum + value,
                    0
                  );
                  Modal.info({
                    title: `偏态值为: ${v}`,
                  });
                }}
              >
                计算
              </Button>
            </Form.Item>
          </Col>
        </Row>
      </Form>
      {!params.key ? (
        <Empty
          description={
            <span>
              请先选择 <span className="text-orange">维度</span>
            </span>
          }
        />
      ) : (
        <>
          <Alert
            message={
              <div>
                <div>
                  超级大乐透“35选5”是随机摇号，在开出的号码中，形成偏态的可能性比较大，因此在偏态产生后，纠正偏态是下一步要做的事情。
                </div>
                <div>
                  首先设定一个偏态参考值18（因为35个前区号码的中间号即为18），把1——35所有的数字都减去18，这样就会形成-17到17的序列，
                </div>
                <div>
                  用正负数的概念来判断偏态与否，最后形成的和值如果在正负18之间就可以认为是正常范围，超过18则是大偏态，小于-18则是小偏态
                </div>
              </div>
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

export default PianTaiFenXi;
