import { useMemo } from "react";
import { Column } from "@ant-design/plots";
import { Col, Empty, Form, InputNumber, Row, Select } from "antd";
import { getAnalysisData } from "@/utils";
import { FORM_ITEM_LAYOUT } from "@/utils/constants";
import useObjectState from "@/hooks/useObjectState";

/**
 * 红球 趋势图
 * @returns
 */
const HongQiuStatistics = () => {
  const [params, updateParams] = useObjectState<{
    region?: number;
    qiu: string;
    key: string;
  }>({
    region: undefined,
    qiu: "红球",
    key: "出现总次数",
  });

  const analysisData = useMemo(() => {
    if (params.key) {
      return getAnalysisData(params.key)[params.qiu!];
    }
    return {};
  }, [params.key, params.qiu]);

  const config = useMemo(() => {
    if (params.key && params.qiu) {
      const data = Object.keys(analysisData)?.map((key) => {
        return {
          数字: Number(key),
          [params.key!]: Number(analysisData[key]),
        };
      });
      return {
        data,
        xField: "数字",
        yField: params.key,
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
              name: "数字",
              field: "数字",
            },
            {
              name: params.key,
              field: params.key,
            },
          ],
        },
        slider: {
          x: true,
          y: false,
        },
      };
    }
    return {};
  }, [analysisData]);

  // #region 渲染DOM
  return (
    <div>
      <Form {...FORM_ITEM_LAYOUT}>
        <Row>
          <Col span={8}>
            <Form.Item label="维度" name="key">
              <Select
                placeholder="请选择"
                className="w-1-1"
                defaultValue={params.key}
                onChange={(v) =>
                  updateParams({
                    key: v as string,
                  })
                }
                options={[
                  { value: "出现总次数", label: "出现总次数" },
                  { value: "平均遗漏值", label: "平均遗漏值" },
                  { value: "最大遗漏值", label: "最大遗漏值" },
                  { value: "最大连出数", label: "最大连出数" },
                ]}
              />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="蓝红球" name="qiu">
              <Select
                placeholder="请选择"
                className="w-1-1"
                defaultValue={params.qiu}
                onChange={(v) =>
                  updateParams({
                    qiu: v as string,
                  })
                }
                options={[
                  { value: "红球", label: "红球" },
                  { value: "蓝球", label: "蓝球" },
                ]}
              />
            </Form.Item>
          </Col>
          {/* <Col span={8}>
            <Form.Item label="区位" name="region">
              <InputNumber
                className="w-1-1"
                placeholder="请输入1或2或3区"
                min={1}
                max={3}
                onChange={(v) =>
                  updateParams({
                    region: v as number,
                  })
                }
              />
            </Form.Item>
          </Col> */}
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
          {/* <Alert
            message={AlertMessage[params.key!]}
            type="info"
            className="mb-24"
          /> */}
          <Column {...config} />
        </>
      )}
    </div>
  );
};

export default HongQiuStatistics;
