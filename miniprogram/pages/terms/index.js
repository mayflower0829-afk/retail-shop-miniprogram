const legal=require('../../data/legal');
Page({data:{updatedAt:legal.updatedAt,sections:legal.terms.map(([title,body])=>({title,body}))},privacy(){wx.navigateTo({url:'/pages/privacy/index'})}});
