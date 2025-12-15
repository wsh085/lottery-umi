// 弹窗表单的布局
export const FORM_ITEM_LAYOUT = {
  labelCol: {
    sm: { span: 8, offset: 0 },
  },
  wrapperCol: {
    sm: { span: 16, offset: 0 },
  },
};

export const AlertMessage: Record<string, string> = {
  '和值': '和值：红球5个球的数值之和',
  '跨度': '跨度：红球5个球中的 最大值 - 最小值',
  '区间比': '区间比：{一区}:{二区}:{三区}；一区：01-12；二区：13-24；三区：25-35',
  '奇偶比': '奇偶比：红球的奇数球个数 ：红球的偶数球个数',
}