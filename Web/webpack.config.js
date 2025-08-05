const path = require('path');

module.exports = {
  mode: 'development', // 'production'으로 설정하면 코드 압축 및 최적화
  entry: './src/index.js', // 번들링을 시작할 JavaScript 파일
  output: {
    filename: 'bundle.js', // 번들링된 파일 이름
    path: path.resolve(__dirname, 'dist'), // 번들링된 파일이 저장될 경로 (프로젝트 루트의 dist 폴더)
    publicPath: '/', // 웹 서버에서 파일을 제공할 기본 경로 (선택 사항, Flask 정적 파일 경로와 맞춤)
  },
  module: {
    rules: [
      {
        test: /\.css$/, // .css 확장자를 가진 파일들을 찾음
        use: ['style-loader', 'css-loader'], // style-loader와 css-loader를 사용하여 CSS 파일을 처리
      },
      // 다른 로더 (예: Babel for ES6+, file-loader for images 등)를 필요에 따라 추가
    ],
  },
  devtool: 'eval-source-map', // 개발 시 디버깅을 위한 소스 맵 설정 (prod에서는 'source-map' 또는 false)
  devServer: { // 개발 서버 설정 (선택 사항, Flask와 함께 사용 시 충돌 가능)
    static: {
      directory: path.join(__dirname, 'public'), // 개발 서버에서 제공할 정적 파일 경로
    },
    compress: true,
    port: 9000,
    open: true, // 서버 시작 시 브라우저 자동 열기
    historyApiFallback: true, // SPA를 위한 설정 (필요시)
  },
};