'use strict';
const {benchmark,BaselineRepository}=require('../tests/helpers/projection-benchmark');
const {SheetsRepository}=require('../source/adapters/sheets');
const rows=[];
for(const size of [3,100,250,1000])for(const [version,Repository] of [['d5af840',BaselineRepository],['current',SheetsRepository]]){
 const result=benchmark(size,Repository);for(const operation of ['read','save'])rows.push({clients:size,version,operation,...result[operation]});
}
console.table(rows);
console.log('Синтетичні лічильники методів, не мережеві RPC або час Google. projectionRows — записані/очищені рядки проєкцій; writtenRows включає журнал і control.');
