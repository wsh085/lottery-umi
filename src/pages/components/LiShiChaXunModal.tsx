import { useMemo, useState } from "react";
import { last } from "lodash-es";
import { Button, Form, Input, Modal, ModalProps } from "antd";
import { FORM_ITEM_LAYOUT } from "@/utils/constants";

interface LiShiChaXunModalProps extends Omit<ModalProps, "onOk" | "onCancel"> {
  /** 获取当前杀号 */
  // handleShaHao: (params: { showModal?: boolean }) => string;
  onOk: () => void;
  onCancel: () => void;
}
/**
 * 历史数据查询方案的准确率验证
 * @returns
 */
const LiShiChaXunModal = (props: LiShiChaXunModalProps) => {
  const [xuanhao, setXuanhao] = useState<number[]>([]);
  const currentShaHao = useMemo(() => [], [props.open]);

  /**
   * 随机获取数组的值
   * @param arr
   * @param count
   * @returns
   */
  const getRandomNumber = (arr: number[], count: number) => {
    const result: number[] = [];
    while (result.length !== count) {
      let randomIndex = Math.floor(Math.random() * arr.length);
      if (!result.includes(arr[randomIndex])) {
        result.push(arr[randomIndex]);
      }
    }
    return result;
  };

  /**
   * 获取临时结果
   */
  const getTempResult = (
    rehao: number[],
    wenhao: number[],
    lenghao: number[],
    rewenlengbi: number[]
  ) => {
    // 随机获取后的热号
    let calRehao = getRandomNumber(rehao, rewenlengbi[0]);
    // 随机获取后的温号
    let calWenhao = getRandomNumber(wenhao, rewenlengbi[1]);
    // 随机获取后的冷号
    let calLenghao = getRandomNumber(lenghao, rewenlengbi[2]);

    return [...calRehao, ...calWenhao, ...calLenghao].sort((a, b) => a - b);
  };

  // 计算临时结果是否满足和值要求
  const calculateHeZhi = (tempResult: number[], hezhi: string): boolean => {
    const isDayu = hezhi.includes(">"); // 是否是大于，不是的话就是小于了
    let hezhiValue = Number(hezhi.substr(1));
    let sum = tempResult.reduce((sum: number, value: number) => sum + value, 0);
    if (isDayu) {
      // 大于
      return sum > hezhiValue;
    } else {
      // 小于
      return sum < hezhiValue;
    }
  };

  // 计算临时结果是否满足跨度要求
  const calculateKuadu = (tempResult: number[], kuadu: string): boolean => {
    const isDayu = kuadu.includes(">"); // 是否是大于，不是的话就是小于了
    let kuaduValue = Number(kuadu.substr(1));
    let differenceValue = last(tempResult)! - tempResult[0];
    if (isDayu) {
      // 大于
      return differenceValue > kuaduValue;
    } else {
      // 小于
      return differenceValue < kuaduValue;
    }
  };

  // 计算临时结果是否满足奇偶比要求
  const calculateJioubi = (tempResult: number[], jioubi: string): boolean => {
    const jioubiValue: number[] = jioubi.split(":")?.map((v) => Number(v));

    let jishu = tempResult?.filter((num) => num % 2 === 1);
    let oushu = tempResult?.filter((num) => num % 2 === 0);

    if (jishu.length === jioubiValue[0] && oushu.length === jioubiValue[1]) {
      return true;
    }
    return false;
  };

  const onFinish = (values: any) => {
    console.info(currentShaHao);
    console.log("Success:", values);
    const currentShaHaoNumber = currentShaHao.split(" ")?.map((v) => Number(v));
    // 热号
    let rehao = values.rehao?.split(",")?.map((v: string) => Number(v));
    // 温号
    let wenhao = values.wenhao?.split(",")?.map((v: string) => Number(v));
    // 冷号
    let lenghao = values.lenghao?.split(",")?.map((v: string) => Number(v));
    // 热:温:冷号比
    const rewenlengbi = values.rewenlengbi
      ?.split(":")
      ?.map((v: string) => Number(v));

    // 将输入的热、温、冷号与当前杀号 做diff 过滤
    rehao = rehao.filter(
      (number: number) => !currentShaHaoNumber.includes(number)
    );
    wenhao = wenhao.filter(
      (number: number) => !currentShaHaoNumber.includes(number)
    );
    lenghao = lenghao.filter(
      (number: number) => !currentShaHaoNumber.includes(number)
    );

    let isAllowBack = false; // 计算结果是否满足条件
    let result: number[] = [];
    while (!isAllowBack) {
      // 临时结果
      let tempResult = getTempResult(rehao, wenhao, lenghao, rewenlengbi);
      if (
        calculateHeZhi(tempResult, values.hezhi) &&
        calculateKuadu(tempResult, values.kuadu) &&
        calculateJioubi(tempResult, values.jioubi)
      ) {
        result = tempResult;
        isAllowBack = true;
      }
    }

    console.info(rehao);
    console.info(wenhao);
    console.info(lenghao);

    setXuanhao(result);
  };

  // #region 渲染DOM
  return (
    <Modal
      title="方法验证"
      footer={
        <Button type="primary" loading={false} onClick={props.onCancel}>
          我知道了
        </Button>
      }
      {...props}
    >
      <Form {...FORM_ITEM_LAYOUT} onFinish={onFinish}>
        <Form.Item label="当前杀号" name="shahao">
          {currentShaHao}
        </Form.Item>
        <Form.Item label="热号" name="rehao">
          <Input className="w-1-1" placeholder="请输入当前热号，英文逗号分隔" />
        </Form.Item>
        <Form.Item label="温号" name="wenhao">
          <Input className="w-1-1" placeholder="请输入当前温号，英文逗号分隔" />
        </Form.Item>
        <Form.Item label="冷号" name="lenghao">
          <Input className="w-1-1" placeholder="请输入当前冷号，英文逗号分隔" />
        </Form.Item>
        <Form.Item label="热:温:冷" name="rewenlengbi">
          <Input className="w-1-1" placeholder="请输入热:温:冷比，如：2:1:2" />
        </Form.Item>
        <Form.Item label="和值" name="hezhi">
          <Input
            className="w-1-1"
            placeholder="请输入和值，带上大于/小于，如：>86"
          />
        </Form.Item>
        <Form.Item label="跨度" name="kuadu">
          <Input
            className="w-1-1"
            placeholder="请输入跨度，带上大于/小于，如：>86"
          />
        </Form.Item>
        <Form.Item label="奇偶比" name="jioubi">
          <Input className="w-1-1" placeholder="请输入奇偶比，如：2:3" />
        </Form.Item>
        <Form.Item label=" " colon={false}>
          <Button type="primary" htmlType="submit">
            计算
          </Button>
        </Form.Item>
      </Form>
      <div className="mt-24">计算结果：{xuanhao?.join("  ")}</div>
    </Modal>
  );
};

export default LiShiChaXunModal;
