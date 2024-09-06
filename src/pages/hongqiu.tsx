import { useMemo } from "react";
import { Line } from "@ant-design/plots";
import { Alert, Col, Empty, Form, InputNumber, Row, Select } from "antd";
import { getHistoryData } from "@/utils";
import { AlertMessage, FORM_ITEM_LAYOUT } from "@/utils/constants";
import useObjectState from "@/hooks/useObjectState";

/**
 * 红球 趋势图
 * @returns
 */
const HongQiuStatistics = () => {
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

  const config = useMemo(() => {
    if (params.key) {
      const data = historyData?.map((d) => {
        return {
          期数: d["期数"].substring(d["期数"].length - 3),
          [params.key!]: ["和值", "跨度"].includes(params.key!)
            ? Number(d[params.key!])
            : d[params.key!],
          红球: d["红球"],
        };
      });
      return {
        data,
        xField: "期数",
        yField: params.key,
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
          <Col span={8}>
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
            message={AlertMessage[params.key!]}
            type="info"
            className="mb-24"
          />
          <Line {...config} />
        </>
      )}
    </div>
  );
};

export default HongQiuStatistics;
